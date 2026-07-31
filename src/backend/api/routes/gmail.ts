/**
 * @fileoverview Gmail Comms Hub — `/api/gmail` (0013 roadmap P3-07)
 *
 * Mounted at `/api/gmail` (see src/backend/api/index.ts), gated end-to-end by
 * `requireAccessAuth` — this is admin-only CRM data, no public read surface.
 *
 *   GET    /api/gmail/threads                             GLOBAL inbox — every thread, newest first, optional search
 *   GET    /api/gmail/companies/:companyId/threads         Threads for a company (by companyId FK, newest first)
 *   GET    /api/gmail/companies/:companyId/threads-by-domain  Threads matched by ANY of a company's contact emails (private domain OR exact public-provider address, indexed)
 *   GET    /api/gmail/threads/:threadId                    One thread + its messages
 *   POST   /api/gmail/threads/:threadId/reply              Reply-all in a thread (sends via Gmail API)
 *   POST   /api/gmail/compose                               Plain send, no thread
 *   POST   /api/gmail/ingest                                Manually trigger ingestion (fire-and-forget)
 *   POST   /api/gmail/draft-assist                          Workers-AI reply draft, grounded via Vectorize
 *   POST   /api/gmail/backfill-participants                 Backfill gmail_message_participants from existing gmail_messages (idempotent, cursor-paged)
 *
 * Conventions:
 *   - Hand-written Zod v4 schemas (drizzle-zod is banned — breaks pnpm run build).
 *   - `drizzle(c.env.DB)` for every DB client — no global mutable state.
 *   - `toRecipientsJson` (DB column, JSON string) <-> `toRecipients` (wire field, string[]).
 *   - The user (justin@126colby.com) is always the sender identity for
 *     reply/compose — the Gmail service account impersonates him via DWD.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq, inArray, isNotNull, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  companies,
  companyContacts,
  contacts,
  gmailMessageAttachments,
  gmailMessageImages,
  gmailMessages,
  gmailThreads,
  showroomPocs,
  showroomStoreContacts,
  showroomStoreLinks,
  showroomStores,
} from "@backend/db";
import type { GmailMessage, GmailMessageInsert, GmailThread } from "@backend/db";

import { getGmailAccessToken } from "@backend/services/gmail/auth";
import { classifyMessage, trimQuotedReply } from "@backend/services/gmail/classify-message";
import { normalizeDomain } from "@backend/services/gmail/ingest-gate-domains";
import { ensureMessageImages } from "@backend/services/gmail/inline-images";
import { sanitizeNoteHtml } from "@backend/services/notes/markdown";
import { buildComposeRaw, buildReplyAllRaw, sendMessage, stripHtmlTags } from "@backend/services/gmail/client";
import { ingestCompanyEmails } from "@backend/services/gmail/ingestion";
import { runIngestGate } from "@backend/services/gmail/ingest-gate";
import {
  buildParticipantRows,
  buildShowroomMatchSpec,
  findThreadIdsByParticipants,
  insertParticipants,
  splitCandidateEmails,
} from "@backend/services/gmail/participants";

export const gmailRouter = new OpenAPIHono<{ Bindings: Env }>();

/** The Workspace identity the service account impersonates and sends as. */
const SENDER_EMAIL = "justin@126colby.com";

/** Snippet length for thread-list previews. */
const SNIPPET_CHARS = 140;

/** D1's hard limit on bound parameters per statement (see documents/db-helpers.ts). */
const D1_MAX_BOUND_PARAMS = 100;

// ─── Shared error envelope ────────────────────────────────────────────────────

const errorSchema = z.object({
  error: z.string(),
});

// ─── Param schemas ────────────────────────────────────────────────────────────

const companyIdParamSchema = z.object({
  companyId: z.string().regex(/^\d+$/, "companyId must be numeric"),
});

const threadIdParamSchema = z.object({
  threadId: z.string().min(1),
});

/** Default/max page size for the global inbox list. */
const INBOX_LIST_DEFAULT_LIMIT = 50;
const INBOX_LIST_MAX_LIMIT = 100;

/**
 * Query params for `GET /threads` (global inbox list). Hand-validated (rather
 * than relying on zod-openapi's coercion alone) so we can 400 with a precise
 * message on NaN/out-of-range input instead of silently clamping.
 */
const inboxListQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
  q: z.string().min(1).optional(),
});

/** Default/max per-call page size for the participants backfill sweep. */
const BACKFILL_DEFAULT_LIMIT = 500;
const BACKFILL_MAX_LIMIT = 1000;

/**
 * Query params for `POST /backfill-participants`. `afterId` is a plain
 * `gmail_messages.id` cursor (not a Gmail-native id) — pass the
 * `nextAfterId` from the previous call's response to resume; omit (or pass
 * `0`) to start from the beginning. Hand-validated (NaN-guard, range-clamp)
 * for the same reason as `inboxListQuerySchema` above: a precise 400 beats
 * silent coercion.
 */
const backfillParticipantsQuerySchema = z.object({
  limit: z.string().optional(),
  afterId: z.string().optional(),
});

// ─── Request body schemas ─────────────────────────────────────────────────────

const replyBodySchema = z
  .object({
    // Plaintext body (legacy). Optional now that html/markdown are accepted,
    // but at least one of body/markdown/html must be present (refined below).
    body: z.string().optional(),
    /** Markdown source from the PlateJS composer (0041). */
    markdown: z.string().optional(),
    /** Rendered HTML from the PlateJS composer (0041); sent as a text/html part. */
    html: z.string().optional(),
  })
  .refine((v) => Boolean(v.body?.trim() || v.markdown?.trim() || v.html?.trim()), {
    message: "reply requires body, markdown, or html",
  });

const composeBodySchema = z.object({
  to: z.array(z.email()).min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
});

const ingestResponseSchema = z.object({
  success: z.literal(true),
  started: z.literal(true),
});

const draftAssistBodySchema = z.object({
  threadId: z.string().min(1),
  instruction: z.string().optional(),
});

/** Inbox folders — each purchase-doc type is its own folder (0042). */
const GMAIL_FOLDERS = ["inbox", "quotes", "receipts", "contracts", "sales", "spam", "trash"] as const;
type GmailFolder = (typeof GMAIL_FOLDERS)[number];
/** Invalid/absent folder values fall back to "inbox". */
const gmailFolderSchema = z.enum(GMAIL_FOLDERS).catch("inbox");

/**
 * The single folder a thread belongs to. Trash wins; then the most-specific
 * classification across the thread's messages (contract > quote > receipt/invoice
 * > sale); then spam; else inbox. One folder per thread so quotes, receipts and
 * contracts are cleanly separated.
 */
function threadFolderFor(
  msgs: { classification: string; isSpam: boolean; deletedAt: Date | null }[],
): GmailFolder {
  if (msgs.some((m) => m.deletedAt != null)) return "trash";
  const has = (k: string) => msgs.some((m) => m.classification === k);
  if (has("contract")) return "contracts";
  if (has("quote")) return "quotes";
  if (has("receipt") || has("invoice")) return "receipts";
  if (has("sale")) return "sales";
  if (msgs.some((m) => m.isSpam)) return "spam";
  return "inbox";
}

function emptyFolderCounts(): Record<GmailFolder, number> {
  return { inbox: 0, quotes: 0, receipts: 0, contracts: 0, sales: 0, spam: 0, trash: 0 };
}

// ─── Response schemas ─────────────────────────────────────────────────────────

const threadListItemSchema = z.object({
  id: z.number(),
  threadId: z.string(),
  subject: z.string().nullable(),
  timestampSent: z.union([z.date(), z.number()]).nullable(),
  companyId: z.number().nullable(),
  messageCount: z.number(),
  latestSnippet: z.string(),
});

const messageSchema = z.object({
  id: z.number(),
  threadId: z.string(),
  messageId: z.string(),
  timestamp: z.union([z.date(), z.number()]).nullable(),
  fromRecipient: z.string(),
  toRecipients: z.array(z.string()),
  subject: z.string().nullable(),
  body: z.string().nullable(),
  /** Sanitized HTML body when available (0041). */
  bodyHtml: z.string().nullable(),
  /** Plaintext body with the quoted-reply tail removed (0041). */
  bodyVisible: z.string().nullable(),
  /** The removed quoted/forwarded tail (0041), shown behind a toggle. "" if none. */
  bodyQuoted: z.string(),
  classification: z.string(),
  isSpam: z.boolean(),
  aiSummary: z.string().nullable(),
  ragUuid: z.string(),
});

const threadDetailSchema = z.object({
  id: z.number(),
  threadId: z.string(),
  subject: z.string().nullable(),
  timestampSent: z.union([z.date(), z.number()]).nullable(),
  companyId: z.number().nullable(),
});

/** A downloadable attachment on a message (0041) — metadata only. */
const attachmentSchema = z.object({
  id: z.number(),
  gmailMessageId: z.number(),
  fileName: z.string().nullable(),
  fileExt: z.string().nullable(),
  fileMimetype: z.string().nullable(),
  fileSizeBytes: z.number().nullable(),
});

/** An embedded (inline) image uploaded to Cloudflare Images (0041). */
const embeddedImageSchema = z.object({
  id: z.number(),
  gmailMessageId: z.number(),
  contentId: z.string().nullable(),
  deliveryUrl: z.string(),
  mimeType: z.string().nullable(),
});

/** The most recent message on a thread, as summarized in list views. */
const lastMessageSchema = z.object({
  from: z.string(),
  subject: z.string().nullable(),
  snippet: z.string(),
  date: z.union([z.date(), z.number()]).nullable(),
});

/**
 * Shared item shape for both `GET /threads` (global inbox) and
 * `GET /companies/:companyId/threads-by-domain` (domain-matched company
 * threads) — same fields, different population strategy per route.
 */
const inboxThreadItemSchema = z.object({
  threadId: z.string(),
  subject: z.string().nullable(),
  companyId: z.number().nullable(),
  companyName: z.string().nullable(),
  lastMessage: lastMessageSchema.nullable(),
  messageCount: z.number().int(),
});

// ─── Serialization helpers ─────────────────────────────────────────────────────

function parseToRecipients(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function serializeMessage(row: GmailMessage) {
  const { visible, quoted } = trimQuotedReply(row.bodyPlainTxt ?? row.body ?? "");
  return {
    id: row.id,
    threadId: row.threadId,
    messageId: row.messageId,
    timestamp: row.timestamp,
    fromRecipient: row.fromRecipient,
    toRecipients: parseToRecipients(row.toRecipientsJson),
    subject: row.subject,
    body: row.body,
    bodyHtml: row.bodyHtml,
    bodyVisible: visible,
    bodyQuoted: quoted,
    classification: row.classification,
    isSpam: row.isSpam,
    aiSummary: row.aiSummary,
    ragUuid: row.ragUuid,
  };
}

function serializeThread(row: GmailThread) {
  return {
    id: row.id,
    threadId: row.threadId,
    subject: row.subject,
    timestampSent: row.timestampSent,
    companyId: row.companyId,
  };
}

/** Strip newlines and truncate to `SNIPPET_CHARS`, preferring `aiSummary` over raw `body`. */
function buildSnippet(msg: Pick<GmailMessage, "aiSummary" | "body"> | undefined): string {
  if (!msg) return "";
  const source = msg.aiSummary || msg.body || "";
  return source.replace(/\s+/g, " ").trim().slice(0, SNIPPET_CHARS);
}

/**
 * Build the shared `{ threadId, subject, companyId, companyName, lastMessage,
 * messageCount }` list-item shape used by both `GET /threads` and
 * `GET /companies/:companyId/threads-by-domain`, given a thread row, its
 * resolved company name (if any), and the pre-fetched messages for that
 * thread (any order — the newest is selected here by `timestamp`).
 */
function buildInboxThreadItem(
  thread: Pick<GmailThread, "threadId" | "subject" | "companyId">,
  companyName: string | null,
  msgsForThread: GmailMessage[],
) {
  const sorted = [...msgsForThread].sort((a, b) => {
    const at = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const bt = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return bt - at;
  });
  const latest = sorted[0];

  return {
    threadId: thread.threadId,
    subject: thread.subject,
    companyId: thread.companyId,
    companyName,
    lastMessage: latest
      ? {
          from: latest.fromRecipient,
          subject: latest.subject,
          snippet: buildSnippet(latest),
          date: latest.timestamp,
        }
      : null,
    messageCount: sorted.length,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// GET /threads — GLOBAL inbox list (every thread, any company, newest first)
// ════════════════════════════════════════════════════════════════════════════

gmailRouter.openapi(
  createRoute({
    method: "get",
    path: "/threads",
    operationId: "listGmailInbox",
    tags: ["Gmail"],
    summary: "Global Gmail inbox — every thread across all companies, newest first, optional search",
    request: {
      query: inboxListQuerySchema,
    },
    responses: {
      200: {
        description: "Global inbox page",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              threads: z.array(inboxThreadItemSchema),
              limit: z.number().int(),
              offset: z.number().int(),
            }),
          },
        },
      },
      400: {
        description: "Validation error (bad limit/offset)",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { limit: limitRaw, offset: offsetRaw, q } = c.req.valid("query");

    // Hand-validate limit/offset: NaN-guard + range-clamp with a 400, rather
    // than silently coercing bad input into a default.
    const limit = limitRaw === undefined ? INBOX_LIST_DEFAULT_LIMIT : Number(limitRaw);
    const offset = offsetRaw === undefined ? 0 : Number(offsetRaw);

    if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1 || limit > INBOX_LIST_MAX_LIMIT) {
      return c.json(
        { error: `limit must be an integer between 1 and ${INBOX_LIST_MAX_LIMIT}` },
        400,
      );
    }
    if (!Number.isFinite(offset) || !Number.isInteger(offset) || offset < 0) {
      return c.json({ error: "offset must be a non-negative integer" }, 400);
    }

    const db = drizzle(c.env.DB);

    try {
      // Search filter: thread.subject OR any message from/subject/body on
      // that thread. Resolved as a subquery of matching threadIds so the page
      // query itself stays a simple, indexable thread scan.
      let matchingThreadIdsFilter: string[] | null = null;
      if (q) {
        const likeTerm = `%${q}%`;
        const subjectMatches = await db
          .select({ threadId: gmailThreads.threadId })
          .from(gmailThreads)
          .where(like(gmailThreads.subject, likeTerm))
          .all();
        const messageMatches = await db
          .select({ threadId: gmailMessages.threadId })
          .from(gmailMessages)
          .where(
            or(
              like(gmailMessages.fromRecipient, likeTerm),
              like(gmailMessages.subject, likeTerm),
              like(gmailMessages.body, likeTerm),
            ),
          )
          .all();
        matchingThreadIdsFilter = Array.from(
          new Set([
            ...subjectMatches.map((r) => r.threadId),
            ...messageMatches.map((r) => r.threadId),
          ]),
        );

        if (matchingThreadIdsFilter.length === 0) {
          return c.json({ success: true as const, threads: [], limit, offset }, 200);
        }
      }

      // Page over threads, newest `timestampSent` first, nulls last, then by
      // id desc as a stable tiebreaker.
      const orderExpr = sql`CASE WHEN ${gmailThreads.timestampSent} IS NULL THEN 1 ELSE 0 END, ${gmailThreads.timestampSent} DESC, ${gmailThreads.id} DESC`;

      let pageRows: GmailThread[] = [];
      if (matchingThreadIdsFilter) {
        if (matchingThreadIdsFilter.length <= D1_MAX_BOUND_PARAMS) {
          // Fits in one statement (D1's bound-param limit is per statement).
          pageRows = await db
            .select()
            .from(gmailThreads)
            .where(inArray(gmailThreads.threadId, matchingThreadIdsFilter))
            .orderBy(orderExpr)
            .limit(limit)
            .offset(offset);
        } else {
          // Large match set: fetch matching threads across chunks, sort
          // in-memory, then slice the requested page. Search result sets
          // large enough to hit this path are rare in this mailbox.
          const all: GmailThread[] = [];
          for (let i = 0; i < matchingThreadIdsFilter.length; i += D1_MAX_BOUND_PARAMS) {
            const slice = matchingThreadIdsFilter.slice(i, i + D1_MAX_BOUND_PARAMS);
            const rows = await db
              .select()
              .from(gmailThreads)
              .where(inArray(gmailThreads.threadId, slice))
              .all();
            all.push(...rows);
          }
          all.sort((a, b) => {
            const at = a.timestampSent ? new Date(a.timestampSent).getTime() : -1;
            const bt = b.timestampSent ? new Date(b.timestampSent).getTime() : -1;
            if (bt !== at) return bt - at;
            return b.id - a.id;
          });
          pageRows = all.slice(offset, offset + limit);
        }
      } else {
        pageRows = await db
          .select()
          .from(gmailThreads)
          .orderBy(orderExpr)
          .limit(limit)
          .offset(offset);
      }

      if (pageRows.length === 0) {
        return c.json({ success: true as const, threads: [], limit, offset }, 200);
      }

      // Resolve company names for this page's threads in one lookup.
      const companyIds = Array.from(
        new Set(pageRows.map((t) => t.companyId).filter((id): id is number => id !== null)),
      );
      const companyNameById = new Map<number, string>();
      if (companyIds.length > 0) {
        const companyRows = await db
          .select({ id: companies.id, name: companies.name })
          .from(companies)
          .where(inArray(companies.id, companyIds))
          .all();
        for (const row of companyRows) companyNameById.set(row.id, row.name);
      }

      // Batch-fetch every message for this page's threads (bounded to
      // `limit`, so this is a single chunked query, never N+1 across the
      // whole table).
      const threadIds = pageRows.map((t) => t.threadId);
      const msgsByThread = new Map<string, GmailMessage[]>();
      for (let i = 0; i < threadIds.length; i += D1_MAX_BOUND_PARAMS) {
        const idsChunk = threadIds.slice(i, i + D1_MAX_BOUND_PARAMS);
        const chunkMsgs = await db
          .select()
          .from(gmailMessages)
          .where(inArray(gmailMessages.threadId, idsChunk))
          .all();
        for (const msg of chunkMsgs) {
          const list = msgsByThread.get(msg.threadId) ?? [];
          list.push(msg);
          msgsByThread.set(msg.threadId, list);
        }
      }

      const result = pageRows.map((thread) =>
        buildInboxThreadItem(
          thread,
          thread.companyId !== null ? (companyNameById.get(thread.companyId) ?? null) : null,
          msgsByThread.get(thread.threadId) ?? [],
        ),
      );

      return c.json({ success: true as const, threads: result, limit, offset }, 200);
    } catch (err) {
      console.error("[gmail] GET /threads error:", err);
      return c.json({ error: "Failed to list inbox" }, 500);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// GET /companies/:companyId/threads
// ════════════════════════════════════════════════════════════════════════════

gmailRouter.openapi(
  createRoute({
    method: "get",
    path: "/companies/{companyId}/threads",
    operationId: "listCompanyGmailThreads",
    tags: ["Gmail"],
    summary: "List Gmail threads for a company, newest timestampSent first",
    request: {
      params: companyIdParamSchema,
    },
    responses: {
      200: {
        description: "Company Gmail threads",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), threads: z.array(threadListItemSchema) }),
          },
        },
      },
      400: {
        description: "Validation error",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { companyId } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const companyIdNum = Number(companyId);

    try {
      const threads = await db
        .select()
        .from(gmailThreads)
        .where(eq(gmailThreads.companyId, companyIdNum))
        .orderBy(desc(gmailThreads.timestampSent));

      // Batch-fetch every message for this page's threads in one (chunked)
      // query instead of one query per thread (was an N+1 for companies with
      // many threads).
      const msgsByThread = new Map<string, GmailMessage[]>();
      if (threads.length > 0) {
        const threadIds = threads.map((t) => t.threadId);
        for (let i = 0; i < threadIds.length; i += D1_MAX_BOUND_PARAMS) {
          const idsChunk = threadIds.slice(i, i + D1_MAX_BOUND_PARAMS);
          const chunkMsgs = await db
            .select()
            .from(gmailMessages)
            .where(inArray(gmailMessages.threadId, idsChunk))
            .orderBy(desc(gmailMessages.timestamp));

          for (const msg of chunkMsgs) {
            const list = msgsByThread.get(msg.threadId) ?? [];
            list.push(msg);
            msgsByThread.set(msg.threadId, list);
          }
        }
      }

      const result = threads.map((thread) => {
        const msgs = msgsByThread.get(thread.threadId) ?? [];
        const latest = msgs[0];
        return {
          ...serializeThread(thread),
          messageCount: msgs.length,
          latestSnippet: latest?.body ? latest.body.slice(0, SNIPPET_CHARS) : "",
        };
      });

      return c.json({ success: true as const, threads: result }, 200);
    } catch (err) {
      console.error("[gmail] GET /companies/:companyId/threads error:", err);
      return c.json({ error: "Failed to list company threads" }, 500);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// GET /companies/:companyId/threads-by-domain
// ════════════════════════════════════════════════════════════════════════════

gmailRouter.openapi(
  createRoute({
    method: "get",
    path: "/companies/{companyId}/threads-by-domain",
    operationId: "listCompanyGmailThreadsByDomain",
    tags: ["Gmail"],
    summary:
      "List Gmail threads matched by ANY of a company's contact emails — private domains matched by domain, public-provider (gmail/yahoo/hotmail/etc) addresses matched exactly — via the indexed gmail_message_participants table",
    request: {
      params: companyIdParamSchema,
    },
    responses: {
      200: {
        description: "Participant-matched company Gmail threads",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              domains: z.array(z.string()),
              emails: z.array(z.string()),
              threads: z.array(inboxThreadItemSchema),
            }),
          },
        },
      },
      404: {
        description: "Company not found",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { companyId } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const companyIdNum = Number(companyId);

    try {
      const [company] = await db
        .select({ id: companies.id, name: companies.name, email: companies.email })
        .from(companies)
        .where(eq(companies.id, companyIdNum))
        .limit(1);

      if (!company) return c.json({ error: "Company not found" }, 404);

      // Gather every candidate contact email for this company: companies.email
      // + every company_contacts contact's email. `splitCandidateEmails`
      // (src/backend/services/gmail/participants.ts) parses + normalizes each
      // one and buckets it: a PRIVATE domain (e.g. "acmeplumbing.com") is
      // matched by domain (catches every POC at that company, even ones we've
      // never recorded as a contact); a PUBLIC provider address (gmail.com,
      // yahoo.com, hotmail.com, etc — see PUBLIC_EMAIL_DOMAINS) is matched by
      // the exact address instead, since domain-matching a public provider
      // would fan out to unrelated mailboxes. A company can have contacts
      // spanning both private and public domains simultaneously — matching is
      // a UNION across every bucketed value.
      const contactEmailRows = await db
        .select({ email: contacts.email })
        .from(companyContacts)
        .innerJoin(contacts, eq(companyContacts.contactId, contacts.id))
        .where(eq(companyContacts.companyId, companyIdNum))
        .all();

      const candidateEmails = [
        company.email,
        ...contactEmailRows.map((r) => r.email),
      ].filter((e): e is string => Boolean(e && e.trim()));

      const { privateDomains, publicEmails } = splitCandidateEmails(candidateEmails);

      // Threads already FK-tagged to this company by ingestion — always
      // included regardless of participant match (e.g. contacts changed since
      // ingestion ran).
      const fkTaggedThreads = await db
        .select()
        .from(gmailThreads)
        .where(eq(gmailThreads.companyId, companyIdNum))
        .all();

      // Indexed lookup against gmail_message_participants.domain /.email —
      // no LIKE scan. Either bucket may be empty; both empty just means we
      // fall back to the FK-tagged threads below.
      const participantThreadIds =
        privateDomains.length > 0 || publicEmails.length > 0
          ? await findThreadIdsByParticipants(db, { privateDomains, publicEmails })
          : [];

      // UNION: FK-tagged threads + participant-matched threads (dedupe by threadId).
      const allThreadIdsSet = new Set<string>([
        ...fkTaggedThreads.map((t) => t.threadId),
        ...participantThreadIds,
      ]);

      const threadsByThreadId = new Map<string, GmailThread>();
      for (const t of fkTaggedThreads) threadsByThreadId.set(t.threadId, t);

      const missingThreadIds = Array.from(allThreadIdsSet).filter(
        (id) => !threadsByThreadId.has(id),
      );
      for (let i = 0; i < missingThreadIds.length; i += D1_MAX_BOUND_PARAMS) {
        const idsChunk = missingThreadIds.slice(i, i + D1_MAX_BOUND_PARAMS);
        const rows = await db
          .select()
          .from(gmailThreads)
          .where(inArray(gmailThreads.threadId, idsChunk))
          .all();
        for (const row of rows) threadsByThreadId.set(row.threadId, row);
      }

      const allThreads = Array.from(threadsByThreadId.values());

      if (allThreads.length === 0) {
        return c.json(
          { success: true as const, domains: privateDomains, emails: publicEmails, threads: [] },
          200,
        );
      }

      // Batch-fetch every message for these threads, chunked.
      const allThreadIds = allThreads.map((t) => t.threadId);
      const msgsByThread = new Map<string, GmailMessage[]>();
      for (let i = 0; i < allThreadIds.length; i += D1_MAX_BOUND_PARAMS) {
        const idsChunk = allThreadIds.slice(i, i + D1_MAX_BOUND_PARAMS);
        const chunkMsgs = await db
          .select()
          .from(gmailMessages)
          .where(inArray(gmailMessages.threadId, idsChunk))
          .all();
        for (const msg of chunkMsgs) {
          const list = msgsByThread.get(msg.threadId) ?? [];
          list.push(msg);
          msgsByThread.set(msg.threadId, list);
        }
      }

      const items = allThreads.map((thread) =>
        buildInboxThreadItem(thread, company.name, msgsByThread.get(thread.threadId) ?? []),
      );

      // Newest-first: by the resolved lastMessage.date, nulls last.
      items.sort((a, b) => {
        const at = a.lastMessage?.date ? new Date(a.lastMessage.date).getTime() : -1;
        const bt = b.lastMessage?.date ? new Date(b.lastMessage.date).getTime() : -1;
        return bt - at;
      });

      return c.json(
        { success: true as const, domains: privateDomains, emails: publicEmails, threads: items },
        200,
      );
    } catch (err) {
      console.error("[gmail] GET /companies/:companyId/threads-by-domain error:", err);
      return c.json({ error: "Failed to list participant-matched company threads" }, 500);
    }
  },
);

/**
 * GET /api/gmail/showrooms/:storeId/threads-by-domain — Gmail threads matched to a
 * showroom's email domains/addresses, with per-message unread counts (0040 P4).
 *
 * Showrooms have no companyId, so there are no FK-tagged threads — matching is
 * purely by the store's emails (store email + main POC email + every POC and
 * store-contact email), bucketed by splitCandidateEmails and looked up via the
 * indexed participants table, exactly like the company route.
 *
 * Response: { success, domains, emails, unreadCount, threads: [{ ...item, unread }] }.
 */
gmailRouter.get("/showrooms/:storeId/threads-by-domain", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("storeId"));
  if (!Number.isFinite(storeId)) return c.json({ error: "Invalid store id" }, 400);

  try {
    const [store] = await db
      .select({ id: showroomStores.id, name: showroomStores.name, email: showroomStores.emailAddress, pocEmail: showroomStores.mainPocEmailAddress, iconUrl: showroomStores.iconCfImagesUrl })
      .from(showroomStores)
      .where(eq(showroomStores.id, storeId))
      .limit(1);
    if (!store) return c.json({ error: "Showroom not found" }, 404);

    const pocRows = await db
      .select({ email: showroomPocs.email })
      .from(showroomPocs)
      .where(eq(showroomPocs.showroomId, storeId))
      .all();
    const contactRows = await db
      .select({ email: showroomStoreContacts.emailAddress })
      .from(showroomStoreContacts)
      .where(eq(showroomStoreContacts.storeId, storeId))
      .all();
    const websiteRows = await db
      .select({ url: showroomStoreLinks.url })
      .from(showroomStoreLinks)
      .where(and(eq(showroomStoreLinks.storeId, storeId), eq(showroomStoreLinks.type, "WEBSITE")))
      .all();

    // A showroom's inbox must show only ITS OWN correspondence. Match the
    // showroom's own domain (store email + WEBSITE links) domain-wide, but
    // match POC/store-contact emails by EXACT address only — those are often
    // reps whose domain belongs to another company, and domain-matching them
    // is what floods the inbox with unrelated companies. See buildShowroomMatchSpec.
    const notBlank = (e: string | null): e is string => Boolean(e && e.trim());
    const { privateDomains, publicEmails } = buildShowroomMatchSpec({
      ownEmails: [store.email].filter(notBlank),
      websiteUrls: websiteRows.map((r) => r.url).filter(notBlank),
      contactEmails: [
        store.pocEmail,
        ...pocRows.map((r) => r.email),
        ...contactRows.map((r) => r.email),
      ].filter(notBlank),
    });

    const threadIds =
      privateDomains.length > 0 || publicEmails.length > 0
        ? await findThreadIdsByParticipants(db, { privateDomains, publicEmails })
        : [];

    if (threadIds.length === 0) {
      return c.json(
        {
          success: true as const,
          domains: privateDomains,
          emails: publicEmails,
          folder: gmailFolderSchema.parse(c.req.query("folder")),
          counts: { inbox: 0, receipts: 0, spam: 0, trash: 0 },
          unreadCount: 0,
          threads: [],
        },
        200,
      );
    }

    // Fetch the threads + their messages, chunked for the bound-param cap.
    const threads: GmailThread[] = [];
    for (let i = 0; i < threadIds.length; i += D1_MAX_BOUND_PARAMS) {
      const chunk = threadIds.slice(i, i + D1_MAX_BOUND_PARAMS);
      const rows = await db.select().from(gmailThreads).where(inArray(gmailThreads.threadId, chunk)).all();
      threads.push(...rows);
    }
    const msgsByThread = new Map<string, GmailMessage[]>();
    const allIds = threads.map((t) => t.threadId);
    for (let i = 0; i < allIds.length; i += D1_MAX_BOUND_PARAMS) {
      const chunk = allIds.slice(i, i + D1_MAX_BOUND_PARAMS);
      const rows = await db.select().from(gmailMessages).where(inArray(gmailMessages.threadId, chunk)).all();
      for (const m of rows) {
        const list = msgsByThread.get(m.threadId) ?? [];
        list.push(m);
        msgsByThread.set(m.threadId, list);
      }
    }

    // Folder foldering (0041). A thread lands in a folder from its messages'
    // classification/isSpam/deletedAt: Trash if soft-deleted; else Spam if any
    // message is spam; else it's in Inbox — and additionally in Receipts when it
    // carries a purchase document. (Inbox excludes spam; Receipts keeps them.)
    const requestedFolder = gmailFolderSchema.parse(c.req.query("folder"));

    const enriched = threads.map((thread) => {
      const msgs = msgsByThread.get(thread.threadId) ?? [];
      const folder = threadFolderFor(msgs);
      const unread = msgs.filter((m) => m.readAt == null && m.deletedAt == null).length;
      return { thread, msgs, unread, folder };
    });

    // Per-folder thread counts + Inbox unread for the folder rail + badge.
    const counts = emptyFolderCounts();
    let unreadCount = 0;
    for (const e of enriched) {
      counts[e.folder] += 1;
      if (e.folder === "inbox") unreadCount += e.unread;
    }

    const items = enriched
      .filter((e) => e.folder === requestedFolder)
      .map((e) => ({
        ...buildInboxThreadItem(e.thread, store.name, e.msgs),
        unread: e.unread,
        isSpam: e.msgs.some((m) => m.isSpam),
        classification: e.folder,
        // Scoped inbox: every thread is this showroom's mail → its brand icon.
        logoUrl: store.iconUrl ?? null,
        spamRationale: e.msgs.find((m) => m.spamRationale)?.spamRationale ?? null,
      }));
    items.sort((a, b) => {
      const at = a.lastMessage?.date ? new Date(a.lastMessage.date).getTime() : -1;
      const bt = b.lastMessage?.date ? new Date(b.lastMessage.date).getTime() : -1;
      return bt - at;
    });

    return c.json(
      {
        success: true as const,
        domains: privateDomains,
        emails: publicEmails,
        folder: requestedFolder,
        counts,
        unreadCount,
        threads: items,
      },
      200,
    );
  } catch (err) {
    console.error("[gmail] GET /showrooms/:storeId/threads-by-domain error:", err);
    return c.json({ error: "Failed to list showroom threads" }, 500);
  }
});

/**
 * POST /api/gmail/threads/:threadId/mark-read — mark every message in a thread as
 * read (0040 P4). Called when a thread is opened in a viewer; idempotent.
 * Response: { success, marked } — how many messages flipped unread → read.
 */
gmailRouter.post("/threads/:threadId/mark-read", async (c) => {
  const db = drizzle(c.env.DB);
  const threadId = c.req.param("threadId");
  if (!threadId) return c.json({ error: "Invalid thread id" }, 400);

  try {
    const unread = await db
      .select({ id: gmailMessages.id })
      .from(gmailMessages)
      .where(and(eq(gmailMessages.threadId, threadId), sql`${gmailMessages.readAt} IS NULL`))
      .all();
    if (unread.length > 0) {
      await db
        .update(gmailMessages)
        .set({ readAt: new Date() })
        .where(and(eq(gmailMessages.threadId, threadId), sql`${gmailMessages.readAt} IS NULL`))
        .run();
    }
    return c.json({ success: true as const, marked: unread.length }, 200);
  } catch (err) {
    console.error("[gmail] POST /threads/:threadId/mark-read error:", err);
    return c.json({ error: "Failed to mark thread read" }, 500);
  }
});

/**
 * POST /api/gmail/threads/:threadId/mark-spam — move a thread to Spam (user
 * action). Sets is_spam on every message with rationale 'manual'. Reversible
 * via mark-not-spam.
 */
gmailRouter.post("/threads/:threadId/mark-spam", async (c) => {
  const db = drizzle(c.env.DB);
  const threadId = c.req.param("threadId");
  if (!threadId) return c.json({ error: "Invalid thread id" }, 400);
  try {
    await db
      .update(gmailMessages)
      .set({ isSpam: true, spamRationale: "manual" })
      .where(eq(gmailMessages.threadId, threadId))
      .run();
    return c.json({ success: true as const }, 200);
  } catch (err) {
    console.error("[gmail] POST /threads/:threadId/mark-spam error:", err);
    return c.json({ error: "Failed to mark thread spam" }, 500);
  }
});

/** POST /api/gmail/threads/:threadId/mark-not-spam — inverse of mark-spam. */
gmailRouter.post("/threads/:threadId/mark-not-spam", async (c) => {
  const db = drizzle(c.env.DB);
  const threadId = c.req.param("threadId");
  if (!threadId) return c.json({ error: "Invalid thread id" }, 400);
  try {
    await db
      .update(gmailMessages)
      .set({ isSpam: false, spamRationale: null })
      .where(eq(gmailMessages.threadId, threadId))
      .run();
    return c.json({ success: true as const }, 200);
  } catch (err) {
    console.error("[gmail] POST /threads/:threadId/mark-not-spam error:", err);
    return c.json({ error: "Failed to unmark thread spam" }, 500);
  }
});

/**
 * GET /api/gmail/inbox?folder=inbox|receipts|spam|trash — the GLOBAL inbox,
 * folder-aware (0042 fix). Same foldering as the per-showroom inbox but over
 * ALL recent threads, so spam is split out of the main list everywhere. Caps at
 * the most recent threads to stay bounded.
 */
gmailRouter.get("/inbox", async (c) => {
  const db = drizzle(c.env.DB);
  const requestedFolder = gmailFolderSchema.parse(c.req.query("folder"));
  try {
    const threads = await db
      .select()
      .from(gmailThreads)
      .orderBy(desc(gmailThreads.timestampSent))
      .limit(300)
      .all();

    const msgsByThread = new Map<string, GmailMessage[]>();
    const ids = threads.map((t) => t.threadId);
    for (let i = 0; i < ids.length; i += D1_MAX_BOUND_PARAMS) {
      const chunk = ids.slice(i, i + D1_MAX_BOUND_PARAMS);
      const rows = await db.select().from(gmailMessages).where(inArray(gmailMessages.threadId, chunk)).all();
      for (const m of rows) {
        const list = msgsByThread.get(m.threadId) ?? [];
        list.push(m);
        msgsByThread.set(m.threadId, list);
      }
    }

    const enriched = threads.map((thread) => {
      const msgs = msgsByThread.get(thread.threadId) ?? [];
      const folder = threadFolderFor(msgs);
      const unread = msgs.filter((m) => m.readAt == null && m.deletedAt == null).length;
      return { thread, msgs, unread, folder };
    });

    const counts = emptyFolderCounts();
    let unreadCount = 0;
    for (const e of enriched) {
      counts[e.folder] += 1;
      if (e.folder === "inbox") unreadCount += e.unread;
    }

    // Map showroom WEBSITE-domain → brand icon, so a sender whose domain matches
    // a showroom shows that showroom's logo instead of initials.
    const iconByDomain = new Map<string, string>();
    const linkRows = await db
      .select({ url: showroomStoreLinks.url, icon: showroomStores.iconCfImagesUrl })
      .from(showroomStoreLinks)
      .innerJoin(showroomStores, eq(showroomStoreLinks.storeId, showroomStores.id))
      .where(and(eq(showroomStoreLinks.type, "WEBSITE"), isNotNull(showroomStores.iconCfImagesUrl)))
      .all();
    for (const r of linkRows) {
      const d = normalizeDomain(r.url);
      if (d && r.icon) iconByDomain.set(d, r.icon);
    }

    const items = enriched
      .filter((e) => e.folder === requestedFolder)
      .map((e) => {
        const item = buildInboxThreadItem(e.thread, "", e.msgs);
        const dom = normalizeDomain(item.lastMessage?.from ?? "");
        return {
          ...item,
          unread: e.unread,
          isSpam: e.msgs.some((m) => m.isSpam),
          classification: e.folder,
          logoUrl: dom ? iconByDomain.get(dom) ?? null : null,
          spamRationale: e.msgs.find((m) => m.spamRationale)?.spamRationale ?? null,
        };
      })
      .sort((a, b) => {
        const at = a.lastMessage?.date ? new Date(a.lastMessage.date).getTime() : -1;
        const bt = b.lastMessage?.date ? new Date(b.lastMessage.date).getTime() : -1;
        return bt - at;
      });

    return c.json(
      { success: true as const, folder: requestedFolder, counts, unreadCount, threads: items },
      200,
    );
  } catch (err) {
    console.error("[gmail] GET /inbox error:", err);
    return c.json({ error: "Failed to list inbox" }, 500);
  }
});

/**
 * POST /api/gmail/threads/:threadId/mark-unread — mark every message in a thread
 * unread (0041). Inverse of mark-read; idempotent.
 */
gmailRouter.openapi(
  createRoute({
    method: "post",
    path: "/threads/{threadId}/mark-unread",
    operationId: "markGmailThreadUnread",
    tags: ["Gmail"],
    summary: "Mark every message in a thread unread",
    request: { params: threadIdParamSchema },
    responses: {
      200: {
        description: "Marked unread",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), marked: z.number().int() }),
          },
        },
      },
      500: { description: "Server error", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { threadId } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    try {
      const read = await db
        .select({ id: gmailMessages.id })
        .from(gmailMessages)
        .where(and(eq(gmailMessages.threadId, threadId), sql`${gmailMessages.readAt} IS NOT NULL`))
        .all();
      if (read.length > 0) {
        await db.update(gmailMessages).set({ readAt: null }).where(eq(gmailMessages.threadId, threadId)).run();
      }
      return c.json({ success: true as const, marked: read.length }, 200);
    } catch (err) {
      console.error("[gmail] POST /threads/:threadId/mark-unread error:", err);
      return c.json({ error: "Failed to mark thread unread" }, 500);
    }
  },
);

/**
 * DELETE /api/gmail/threads/:threadId — soft-delete a thread (0041): stamp
 * deleted_at on every message so it moves to the inbox's Trash folder. Does NOT
 * touch Gmail; this is our local inbox view only. Idempotent.
 */
gmailRouter.openapi(
  createRoute({
    method: "delete",
    path: "/threads/{threadId}",
    operationId: "deleteGmailThread",
    tags: ["Gmail"],
    summary: "Soft-delete a thread (move to Trash) — local inbox view only",
    request: { params: threadIdParamSchema },
    responses: {
      200: {
        description: "Moved to Trash",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), deleted: z.number().int() }),
          },
        },
      },
      500: { description: "Server error", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { threadId } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    try {
      const live = await db
        .select({ id: gmailMessages.id })
        .from(gmailMessages)
        .where(and(eq(gmailMessages.threadId, threadId), sql`${gmailMessages.deletedAt} IS NULL`))
        .all();
      if (live.length > 0) {
        await db
          .update(gmailMessages)
          .set({ deletedAt: new Date() })
          .where(and(eq(gmailMessages.threadId, threadId), sql`${gmailMessages.deletedAt} IS NULL`))
          .run();
      }
      return c.json({ success: true as const, deleted: live.length }, 200);
    } catch (err) {
      console.error("[gmail] DELETE /threads/:threadId error:", err);
      return c.json({ error: "Failed to delete thread" }, 500);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// GET /threads/:threadId
// ════════════════════════════════════════════════════════════════════════════

gmailRouter.openapi(
  createRoute({
    method: "get",
    path: "/threads/{threadId}",
    operationId: "getGmailThread",
    tags: ["Gmail"],
    summary: "Get a Gmail thread (by Gmail-native thread id) + its messages, chronological",
    request: {
      params: threadIdParamSchema,
    },
    responses: {
      200: {
        description: "Gmail thread + messages",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              thread: threadDetailSchema,
              messages: z.array(messageSchema),
              attachments: z.array(attachmentSchema),
              images: z.array(embeddedImageSchema),
            }),
          },
        },
      },
      404: {
        description: "Thread not found",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { threadId } = c.req.valid("param");
    const db = drizzle(c.env.DB);

    try {
      const [thread] = await db
        .select()
        .from(gmailThreads)
        .where(eq(gmailThreads.threadId, threadId))
        .limit(1);

      if (!thread) return c.json({ error: "Thread not found" }, 404);

      const msgs = await db
        .select()
        .from(gmailMessages)
        .where(eq(gmailMessages.threadId, threadId))
        .orderBy(gmailMessages.timestamp);

      // Attachments + embedded images for this thread's messages (0041).
      const msgIds = msgs.map((m) => m.id);
      const attachmentRows =
        msgIds.length > 0
          ? await db
              .select()
              .from(gmailMessageAttachments)
              .where(inArray(gmailMessageAttachments.gmailMessageId, msgIds))
              .all()
          : [];

      // Embedded images: upload cid: images to Cloudflare Images on first view
      // (idempotent, guarded by images_extracted), then read the full set.
      for (const m of msgs) {
        if (!m.imagesExtracted) await ensureMessageImages(c.env, db, m);
      }
      const imageRows =
        msgIds.length > 0
          ? await db
              .select()
              .from(gmailMessageImages)
              .where(inArray(gmailMessageImages.gmailMessageId, msgIds))
              .all()
          : [];

      return c.json(
        {
          success: true as const,
          thread: serializeThread(thread),
          messages: msgs.map(serializeMessage),
          attachments: attachmentRows.map((a) => ({
            id: a.id,
            gmailMessageId: a.gmailMessageId,
            fileName: a.fileName,
            fileExt: a.fileExt,
            fileMimetype: a.fileMimetype,
            fileSizeBytes: a.fileSizeBytes,
          })),
          images: imageRows.map((i) => ({
            id: i.id,
            gmailMessageId: i.gmailMessageId,
            contentId: i.contentId,
            deliveryUrl: i.deliveryUrl,
            mimeType: i.mimeType,
          })),
        },
        200,
      );
    } catch (err) {
      console.error("[gmail] GET /threads/:threadId error:", err);
      return c.json({ error: "Failed to get thread" }, 500);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// POST /threads/:threadId/reply
// ════════════════════════════════════════════════════════════════════════════

gmailRouter.openapi(
  createRoute({
    method: "post",
    path: "/threads/{threadId}/reply",
    operationId: "replyToGmailThread",
    tags: ["Gmail"],
    summary: "Reply-all to the latest message in a thread and send via the Gmail API",
    request: {
      params: threadIdParamSchema,
      body: {
        required: true,
        content: { "application/json": { schema: replyBodySchema } },
      },
    },
    responses: {
      200: {
        description: "Reply sent",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), messageId: z.string() }),
          },
        },
      },
      404: {
        description: "Thread not found or has no messages",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error (send failure)",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { threadId } = c.req.valid("param");
    const { body, markdown, html } = c.req.valid("json");
    const db = drizzle(c.env.DB);

    // Plaintext part: explicit body, else the PlateJS markdown, else stripped
    // from the HTML — never empty when html-only is submitted (7bit/consumers
    // expect a real text/plain part). The refine guarantees ≥1 input is present.
    const htmlBody = html?.trim() ? html : null;
    const plainText = (body?.trim() || markdown?.trim() || (htmlBody ? stripHtmlTags(htmlBody) : "")).trim();

    try {
      const [latest] = await db
        .select()
        .from(gmailMessages)
        .where(eq(gmailMessages.threadId, threadId))
        .orderBy(desc(gmailMessages.timestamp))
        .limit(1);

      if (!latest) return c.json({ error: "Thread not found or has no messages" }, 404);

      const originalTo = parseToRecipients(latest.toRecipientsJson);
      const recipients = new Set(
        [latest.fromRecipient, ...originalTo]
          .map((addr) => addr.trim())
          .filter((addr) => addr && !addr.toLowerCase().includes(SENDER_EMAIL.toLowerCase())),
      );

      const raw = buildReplyAllRaw({
        from: SENDER_EMAIL,
        to: [...recipients],
        subject: latest.subject || "(no subject)",
        // We do not persist RFC-822 Message-Id headers on ingested rows —
        // Gmail's `threadId` param on send is sufficient for correct
        // threading server-side.
        inReplyTo: null,
        references: null,
        body: plainText,
        html: htmlBody,
      });

      const token = await getGmailAccessToken(c.env);
      const sent = await sendMessage(token, raw, threadId);

      const insertValues: GmailMessageInsert = {
        threadId,
        messageId: sent.id,
        timestamp: new Date(),
        fromRecipient: SENDER_EMAIL,
        toRecipientsJson: JSON.stringify([...recipients]),
        subject: latest.subject || null,
        body: plainText,
        bodyPlainTxt: plainText,
        bodyHtml: htmlBody ? sanitizeNoteHtml(htmlBody) : null,
        ragUuid: crypto.randomUUID(),
      };

      await db.insert(gmailMessages).values(insertValues).onConflictDoNothing().run();
      await db
        .update(gmailThreads)
        .set({ timestampSent: new Date(), updatedAt: new Date() })
        .where(eq(gmailThreads.threadId, threadId))
        .run();

      return c.json({ success: true as const, messageId: sent.id }, 200);
    } catch (err) {
      console.error("[gmail] POST /threads/:threadId/reply error:", err);
      return c.json({ error: "Failed to send reply" }, 500);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// POST /compose
// ════════════════════════════════════════════════════════════════════════════

gmailRouter.openapi(
  createRoute({
    method: "post",
    path: "/compose",
    operationId: "composeGmail",
    tags: ["Gmail"],
    summary: "Send a new (non-threaded) email via the Gmail API",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: composeBodySchema } },
      },
    },
    responses: {
      200: {
        description: "Email sent",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), messageId: z.string() }),
          },
        },
      },
      400: {
        description: "Validation error",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error (send failure)",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { to, subject, body } = c.req.valid("json");

    try {
      const raw = buildComposeRaw({ from: SENDER_EMAIL, to, subject, body });
      const token = await getGmailAccessToken(c.env);
      const sent = await sendMessage(token, raw);
      return c.json({ success: true as const, messageId: sent.id }, 200);
    } catch (err) {
      console.error("[gmail] POST /compose error:", err);
      return c.json({ error: "Failed to send email" }, 500);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// POST /ingest — manual trigger
// ════════════════════════════════════════════════════════════════════════════

gmailRouter.openapi(
  createRoute({
    method: "post",
    path: "/ingest",
    operationId: "triggerGmailIngest",
    tags: ["Gmail"],
    summary: "Manually trigger Gmail ingestion for all contractor companies (fire-and-forget)",
    responses: {
      202: {
        description: "Ingestion started",
        content: { "application/json": { schema: ingestResponseSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    try {
      c.executionCtx.waitUntil(
        ingestCompanyEmails(c.env).catch((err) => {
          console.error("[gmail] /ingest background run failed:", err);
        }),
      );
      return c.json({ success: true as const, started: true as const }, 202);
    } catch (err) {
      console.error("[gmail] POST /ingest error:", err);
      return c.json({ error: "Failed to start ingestion" }, 500);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// POST /ingest-gate — manual trigger for the 0039 domain-matched vendor pull
// ════════════════════════════════════════════════════════════════════════════

gmailRouter.openapi(
  createRoute({
    method: "post",
    path: "/ingest-gate",
    operationId: "triggerGmailIngestGate",
    tags: ["Gmail"],
    summary:
      "Manually run the ingest gate: pull vendor mail whose domain matches a known showroom/company into the extraction pipeline (fire-and-forget). Optional ?domain= (comma-separated) bounds the run to specific vendor domains.",
    request: {
      query: z.object({
        domain: z
          .string()
          .optional()
          .describe("Comma-separated domain allow-list, e.g. pietrafina.com — bounds the run"),
      }),
    },
    responses: {
      202: {
        description: "Ingest gate started",
        content: { "application/json": { schema: ingestResponseSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    try {
      const domainParam = c.req.query("domain");
      const onlyDomains = domainParam
        ? domainParam.split(",").map((d) => d.trim()).filter(Boolean)
        : undefined;
      c.executionCtx.waitUntil(
        runIngestGate(c.env, { onlyDomains })
          .then((r) =>
            console.log(
              `[gmail] /ingest-gate: domains=${r.domainsSearched} candidates=${r.candidates} ` +
                `new=${r.newMessages} processed=${r.processed} failed=${r.failed}`,
            ),
          )
          .catch((err) => console.error("[gmail] /ingest-gate background run failed:", err)),
      );
      return c.json({ success: true as const, started: true as const }, 202);
    } catch (err) {
      console.error("[gmail] POST /ingest-gate error:", err);
      return c.json({ error: "Failed to start ingest gate" }, 500);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// POST /draft-assist
// ════════════════════════════════════════════════════════════════════════════

const DRAFT_ASSIST_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-loftq";
const DRAFT_ASSIST_MAX_MESSAGES = 10;
const DRAFT_ASSIST_SYSTEM_PROMPT =
  "You draft a reply as Justin, the homeowner corresponding with a contractor/vendor about his home renovation project. Be concise, professional, and specific to the conversation. Do not invent facts not present in the transcript or grounding context. Return only the email body text — no subject line, no signature block, no markdown fences.";

gmailRouter.openapi(
  createRoute({
    method: "post",
    path: "/draft-assist",
    operationId: "draftAssistGmail",
    tags: ["Gmail"],
    summary: "Generate a Workers-AI reply draft for a thread, grounded via Vectorize",
    request: {
      body: {
        required: true,
        content: { "application/json": { schema: draftAssistBodySchema } },
      },
    },
    responses: {
      200: {
        description: "Draft generated",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), draft: z.string() }),
          },
        },
      },
      404: {
        description: "Thread not found",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { threadId, instruction } = c.req.valid("json");
    const db = drizzle(c.env.DB);

    try {
      const msgs = await db
        .select()
        .from(gmailMessages)
        .where(eq(gmailMessages.threadId, threadId))
        .orderBy(desc(gmailMessages.timestamp))
        .limit(DRAFT_ASSIST_MAX_MESSAGES);

      if (msgs.length === 0) return c.json({ error: "Thread not found" }, 404);

      const chronological = [...msgs].reverse();
      const latest = msgs[0];

      // Extra grounding: embed the latest message body and pull related Gmail
      // vectors from Vectorize (any thread/party), filtered to kind:"gmail".
      // Non-fatal on failure — the transcript alone is enough context.
      let groundingContext = "";
      try {
        const embedResult = (await c.env.AI.run("@cf/baai/bge-large-en-v1.5", {
          text: [latest.body ?? latest.subject ?? ""],
          gateway: { id: c.env.AI_GATEWAY_ID },
        } as Parameters<typeof c.env.AI.run>[1])) as { data: number[][] };
        const vector = embedResult.data?.[0];
        if (vector) {
          const matches = await c.env.VECTOR_INDEX.query(vector, {
            topK: 5,
            filter: { kind: "gmail" },
            returnMetadata: "all",
          });
          const groundingMessageIds = [
            ...new Set(
              matches.matches
                .map((m) =>
                  typeof m.metadata?.message_id === "string" ? m.metadata.message_id : null,
                )
                .filter((id): id is string => Boolean(id) && id !== latest.messageId),
            ),
          ];
          if (groundingMessageIds.length > 0) {
            // Deliberately NOT scoped to `threadId` — Vectorize matches can (and
            // are meant to) come from other threads/parties, so we look these
            // messages up by their Gmail-native messageId across the whole
            // table, chunked to respect D1's bound-parameter limit.
            const groundingRows: GmailMessage[] = [];
            for (let i = 0; i < groundingMessageIds.length; i += D1_MAX_BOUND_PARAMS) {
              const idsChunk = groundingMessageIds.slice(i, i + D1_MAX_BOUND_PARAMS);
              const rows = await db
                .select()
                .from(gmailMessages)
                .where(inArray(gmailMessages.messageId, idsChunk))
                .all();
              groundingRows.push(...rows);
            }
            groundingContext = groundingRows
              .map((m) => `[${m.fromRecipient}]: ${(m.body ?? "").slice(0, 500)}`)
              .join("\n\n");
          }
        }
      } catch (vectorErr) {
        console.error("[gmail] draft-assist vectorize grounding failed:", vectorErr);
      }

      const transcript = chronological
        .map((m) => `From: ${m.fromRecipient}\nSubject: ${m.subject ?? ""}\n\n${m.body ?? ""}`)
        .join("\n\n---\n\n");

      const userContent = [
        `Thread transcript:\n${transcript}`,
        groundingContext ? `Related prior context:\n${groundingContext}` : "",
        instruction ? `Instruction: ${instruction}` : "Draft a reasonable, helpful reply.",
      ]
        .filter(Boolean)
        .join("\n\n");

      const raw = (await c.env.AI.run(DRAFT_ASSIST_MODEL as Parameters<typeof c.env.AI.run>[0], {
        messages: [
          { role: "system", content: DRAFT_ASSIST_SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        max_tokens: 1024,
        gateway: { id: c.env.AI_GATEWAY_ID },
      } as Parameters<typeof c.env.AI.run>[1])) as {
        response?: string;
        // Some Workers AI models return the chat-completions envelope instead of
        // `.response` (documented repo gotcha) — read both before giving up.
        choices?: { message?: { content?: string } }[];
      };

      const draft = (raw?.response ?? raw?.choices?.[0]?.message?.content ?? "").trim();
      if (!draft) {
        // Surface WHAT came back so a real failure (rate-limit, empty content)
        // isn't hidden behind a generic 500.
        console.error("[gmail] draft-assist empty draft; envelope:", JSON.stringify(raw)?.slice(0, 500));
        return c.json({ error: "The model returned an empty draft. Try again." }, 500);
      }

      return c.json({ success: true as const, draft }, 200);
    } catch (err) {
      // Log the real cause server-side; return a generic message so provider/
      // runtime internals don't leak to the client.
      console.error("[gmail] POST /draft-assist error:", err);
      return c.json({ error: "Failed to generate draft. Please try again." }, 500);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// POST /backfill-participants
// ════════════════════════════════════════════════════════════════════════════

gmailRouter.openapi(
  createRoute({
    method: "post",
    path: "/backfill-participants",
    operationId: "backfillGmailParticipants",
    tags: ["Gmail"],
    summary:
      "Backfill gmail_message_participants for existing gmail_messages rows (idempotent, cursor-paged — safe to re-run)",
    request: {
      query: backfillParticipantsQuerySchema,
    },
    responses: {
      200: {
        description: "Backfill page processed",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              processedMessages: z.number().int(),
              insertedApprox: z.number().int(),
              nextAfterId: z.number().int().nullable(),
            }),
          },
        },
      },
      400: {
        description: "Validation error (bad limit/afterId)",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const { limit: limitRaw, afterId: afterIdRaw } = c.req.valid("query");

    const limit = limitRaw === undefined ? BACKFILL_DEFAULT_LIMIT : Number(limitRaw);
    const afterId = afterIdRaw === undefined ? 0 : Number(afterIdRaw);

    if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1 || limit > BACKFILL_MAX_LIMIT) {
      return c.json(
        { error: `limit must be an integer between 1 and ${BACKFILL_MAX_LIMIT}` },
        400,
      );
    }
    if (!Number.isFinite(afterId) || !Number.isInteger(afterId) || afterId < 0) {
      return c.json({ error: "afterId must be a non-negative integer" }, 400);
    }

    const db = drizzle(c.env.DB);

    try {
      // Walk gmail_messages in ascending-id pages of `limit`, starting after
      // `afterId`. Each message's fromRecipient/toRecipientsJson is parsed
      // into gmail_message_participants rows via the same
      // buildParticipantRows() ingestion uses, then written with
      // insertParticipants()'s onConflictDoNothing() chunked insert — so
      // re-running this endpoint (with the same or overlapping cursor ranges)
      // never creates duplicate rows.
      const page = await db
        .select({
          id: gmailMessages.id,
          threadId: gmailMessages.threadId,
          fromRecipient: gmailMessages.fromRecipient,
          toRecipientsJson: gmailMessages.toRecipientsJson,
        })
        .from(gmailMessages)
        .where(sql`${gmailMessages.id} > ${afterId}`)
        .orderBy(gmailMessages.id)
        .limit(limit)
        .all();

      if (page.length === 0) {
        return c.json(
          { success: true as const, processedMessages: 0, insertedApprox: 0, nextAfterId: null },
          200,
        );
      }

      // Accumulate every message's participant rows, then insert once (the
      // insert itself batches) — one chunked write per page, not one per
      // message (a 500-message page would otherwise be 500 round-trips).
      const allRows = page.flatMap((msg) =>
        buildParticipantRows({
          messageId: msg.id,
          threadId: msg.threadId,
          from: msg.fromRecipient,
          toRecipients: parseToRecipients(msg.toRecipientsJson),
        }),
      );
      await insertParticipants(db, allRows);
      const insertedApprox = allRows.length;

      const lastId = page[page.length - 1]?.id ?? null;
      const nextAfterId = page.length === limit ? lastId : null;

      return c.json(
        {
          success: true as const,
          processedMessages: page.length,
          insertedApprox,
          nextAfterId,
        },
        200,
      );
    } catch (err) {
      console.error("[gmail] POST /backfill-participants error:", err);
      return c.json({ error: "Failed to backfill participants" }, 500);
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// POST /backfill-classification (0041)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Re-run the deterministic classifier over EXISTING gmail_messages so the
 * back-catalogue gets spam/receipt foldering (new rows already get it at
 * ingestion). Cursor-paged by ascending id; idempotent — re-running just
 * recomputes the same values. NO AI.
 */
gmailRouter.openapi(
  createRoute({
    method: "post",
    path: "/backfill-classification",
    operationId: "backfillGmailClassification",
    tags: ["Gmail"],
    summary: "Re-classify existing gmail_messages (spam/receipt), cursor-paged, idempotent",
    request: { query: backfillParticipantsQuerySchema },
    responses: {
      200: {
        description: "Backfill page processed",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              processedMessages: z.number().int(),
              spamFlagged: z.number().int(),
              nextAfterId: z.number().int().nullable(),
            }),
          },
        },
      },
      400: { description: "Validation error", content: { "application/json": { schema: errorSchema } } },
      500: { description: "Server error", content: { "application/json": { schema: errorSchema } } },
    },
  }),
  async (c) => {
    const { limit: limitRaw, afterId: afterIdRaw } = c.req.valid("query");
    const limit = limitRaw === undefined ? BACKFILL_DEFAULT_LIMIT : Number(limitRaw);
    const afterId = afterIdRaw === undefined ? 0 : Number(afterIdRaw);
    if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit < 1 || limit > BACKFILL_MAX_LIMIT) {
      return c.json({ error: `limit must be an integer between 1 and ${BACKFILL_MAX_LIMIT}` }, 400);
    }
    if (!Number.isFinite(afterId) || !Number.isInteger(afterId) || afterId < 0) {
      return c.json({ error: "afterId must be a non-negative integer" }, 400);
    }

    const db = drizzle(c.env.DB);
    try {
      const page = await db
        .select({
          id: gmailMessages.id,
          fromRecipient: gmailMessages.fromRecipient,
          subject: gmailMessages.subject,
          body: gmailMessages.body,
          bodyPlainTxt: gmailMessages.bodyPlainTxt,
        })
        .from(gmailMessages)
        .where(sql`${gmailMessages.id} > ${afterId}`)
        .orderBy(gmailMessages.id)
        .limit(limit)
        .all();

      if (page.length === 0) {
        return c.json(
          { success: true as const, processedMessages: 0, spamFlagged: 0, nextAfterId: null },
          200,
        );
      }

      // Which of these messages carry attachments (chunked to respect D1's
      // 100-bound-param cap on the IN list).
      const pageIds = page.map((p) => p.id);
      const withAttachments = new Set<number>();
      for (let i = 0; i < pageIds.length; i += 100) {
        const chunk = pageIds.slice(i, i + 100);
        const rows = await db
          .select({ mid: gmailMessageAttachments.gmailMessageId })
          .from(gmailMessageAttachments)
          .where(inArray(gmailMessageAttachments.gmailMessageId, chunk))
          .all();
        for (const r of rows) withAttachments.add(r.mid);
      }

      // Recompute and collect per-row updates.
      let spamFlagged = 0;
      const updates = page.map((m) => {
        const gate = classifyMessage({
          from: m.fromRecipient,
          subject: m.subject ?? "",
          body: m.bodyPlainTxt ?? m.body ?? "",
          hasAttachments: withAttachments.has(m.id),
        });
        if (gate.isSpam) spamFlagged += 1;
        return db
          .update(gmailMessages)
          .set({
            classification: gate.classification,
            isSpam: gate.isSpam,
            spamRationale: gate.spamRationale,
          })
          .where(eq(gmailMessages.id, m.id));
      });

      // One atomic batch per ≤100 statements (each statement is well under the
      // per-statement bound-param cap).
      for (let i = 0; i < updates.length; i += 100) {
        const slice = updates.slice(i, i + 100);
        if (slice.length === 0) continue;
        await db.batch(slice as [(typeof slice)[number], ...(typeof slice)[number][]]);
      }

      const lastId = page[page.length - 1]?.id ?? null;
      const nextAfterId = page.length === limit ? lastId : null;

      return c.json(
        { success: true as const, processedMessages: page.length, spamFlagged, nextAfterId },
        200,
      );
    } catch (err) {
      console.error("[gmail] POST /backfill-classification error:", err);
      return c.json({ error: "Failed to backfill classification" }, 500);
    }
  },
);
