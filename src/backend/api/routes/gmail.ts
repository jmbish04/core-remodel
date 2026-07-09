/**
 * @fileoverview Gmail Comms Hub — `/api/gmail` (0013 roadmap P3-07)
 *
 * Mounted at `/api/gmail` (see src/backend/api/index.ts), gated end-to-end by
 * `requireAccessAuth` — this is admin-only CRM data, no public read surface.
 *
 *   GET    /api/gmail/companies/:companyId/threads       Threads for a company (newest first)
 *   GET    /api/gmail/threads/:threadId                  One thread + its messages
 *   POST   /api/gmail/threads/:threadId/reply            Reply-all in a thread (sends via Gmail API)
 *   POST   /api/gmail/compose                             Plain send, no thread
 *   POST   /api/gmail/ingest                              Manually trigger ingestion (fire-and-forget)
 *   POST   /api/gmail/draft-assist                         Workers-AI reply draft, grounded via Vectorize
 *
 * Conventions:
 *   - Hand-written Zod v4 schemas (drizzle-zod is banned — breaks pnpm run build).
 *   - `drizzle(c.env.DB)` for every DB client — no global mutable state.
 *   - `toRecipientsJson` (DB column, JSON string) <-> `toRecipients` (wire field, string[]).
 *   - The user (justin@126colby.com) is always the sender identity for
 *     reply/compose — the Gmail service account impersonates him via DWD.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { gmailMessages, gmailThreads } from "@backend/db";
import type { GmailMessage, GmailMessageInsert, GmailThread } from "@backend/db";

import { getGmailAccessToken } from "@backend/services/gmail/auth";
import { buildComposeRaw, buildReplyAllRaw, sendMessage } from "@backend/services/gmail/client";
import { ingestCompanyEmails } from "@backend/services/gmail/ingestion";

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

// ─── Request body schemas ─────────────────────────────────────────────────────

const replyBodySchema = z.object({
  body: z.string().min(1),
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
  return {
    id: row.id,
    threadId: row.threadId,
    messageId: row.messageId,
    timestamp: row.timestamp,
    fromRecipient: row.fromRecipient,
    toRecipients: parseToRecipients(row.toRecipientsJson),
    subject: row.subject,
    body: row.body,
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

      return c.json(
        {
          success: true as const,
          thread: serializeThread(thread),
          messages: msgs.map(serializeMessage),
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
    const { body } = c.req.valid("json");
    const db = drizzle(c.env.DB);

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
        body,
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
        body,
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
      } as Parameters<typeof c.env.AI.run>[1])) as { response?: string };

      const draft = raw?.response?.trim() ?? "";
      if (!draft) throw new Error("Workers AI returned an empty draft");

      return c.json({ success: true as const, draft }, 200);
    } catch (err) {
      console.error("[gmail] POST /draft-assist error:", err);
      return c.json({ error: "Failed to generate draft" }, 500);
    }
  },
);
