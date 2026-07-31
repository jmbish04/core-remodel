/**
 * @fileoverview Gmail Ingest Gate (0039) — the cheap, domain-matched vendor-mail
 * pull.
 *
 * Vendor mail (showrooms, contractors) lands in the personal inbox
 * (justin@126colby.com), NOT `remodel@hacolby.app`, so the worker's extraction
 * pipeline never sees it. The existing Gmail sync (`ingestion.ts`) only pulls
 * mail for contractor `companies` that already have contact rows — a showroom
 * like Pietra Fina (a `showroom_stores` row, not a `companies` row) is invisible
 * to it. This gate closes that gap WITHOUT spending AI/OCR budget on irrelevant
 * mail:
 *
 *   - It builds a search set from every KNOWN entity domain — showroom `WEBSITE`
 *     link domains ∪ `companies.website` domains — minus our own addresses and
 *     public providers, and Gmail-searches each. Because the domain filter is
 *     the search QUERY, non-matching mail is never even fetched: the "$0 for
 *     non-matches" guarantee is enforced server-side by Gmail, not by
 *     scan-then-skip.
 *   - Each matched message is deduped by Gmail message id (already-ingested
 *     messages are skipped), its thread/message/participant/attachment rows are
 *     recorded, and its raw RFC-822 is handed to the SAME `processEmail`
 *     pipeline that real worker mail uses — which does the attachment OCR,
 *     classification, and invoice/receipt/showroom-contact persistence.
 *
 * Label-driven ingestion (user files a missed thread under a managed Gmail
 * label → process unconditionally) is a separate follow-up (0039 Part D) that
 * reuses this module's per-message ingest+bridge helper.
 */

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  companies,
  gmailMessageAttachments,
  gmailMessageParticipants,
  gmailMessages,
  gmailThreads,
  showroomStoreLinks,
} from "@backend/db";

import { CATCH_ALL_PROFILE } from "@backend/services/email/routes";
import type { RouteDecision } from "@backend/services/email/types";
// NOTE: `processEmail` (the email pipeline) is imported DYNAMICALLY inside the
// bridge below — never statically. It pulls heavy deps (liteparse WASM,
// postal-mime, AI extraction) and the Worker entry (`_worker.ts`) deliberately
// keeps it in a lazy chunk (its `email()` handler `await import()`s it too).
// A static import here drags all of it into the main graph and breaks the
// @astrojs/cloudflare build (`astro:build:done` ENOENT on a moved `_astro`
// chunk). Keep it lazy.

import { getGmailAccessToken } from "./auth";
import { classifyMessage } from "./classify-message";
import {
  extractMessage,
  getMessage,
  getRawMessage,
  searchMessages,
  type GmailMessageFull,
} from "./client";
import {
  PUBLIC_EMAIL_DOMAINS,
  buildParticipantRows,
  insertParticipants,
} from "./participants";
import { isGatedDomain, normalizeDomain } from "./ingest-gate-domains";

// Re-export so existing importers (route filter) keep resolving from here.
export { normalizeDomain } from "./ingest-gate-domains";

/** D1's hard cap on bound parameters per statement. */
const D1_MAX_BOUND_PARAMS = 100;

/** Cap on new messages pulled per domain per run — keeps a cron tick bounded. */
const MAX_NEW_MESSAGES_PER_DOMAIN = 25;

/** What a matched domain resolves to — a showroom store, a company, or both. */
interface DomainMatch {
  showroomStoreId?: number;
  companyId?: number;
}

/**
 * Build the domain → entity map the gate searches on: showroom `WEBSITE` link
 * domains and `companies.website` domains, minus our own domains and public
 * providers (domain-searching a public provider would fan out to the whole
 * mailbox). A domain present on both a showroom and a company carries both ids.
 */
export async function collectGatedDomains(
  db: ReturnType<typeof drizzle>,
): Promise<Map<string, DomainMatch>> {
  const map = new Map<string, DomainMatch>();

  const linkRows = await db
    .select({ storeId: showroomStoreLinks.storeId, url: showroomStoreLinks.url })
    .from(showroomStoreLinks)
    .where(eq(showroomStoreLinks.type, "WEBSITE"))
    .all();
  for (const row of linkRows) {
    const domain = normalizeDomain(row.url);
    if (!domain || !isGatedDomain(domain, PUBLIC_EMAIL_DOMAINS)) continue;
    const entry = map.get(domain) ?? {};
    entry.showroomStoreId ??= row.storeId;
    map.set(domain, entry);
  }

  const companyRows = await db
    .select({ id: companies.id, website: companies.website })
    .from(companies)
    .where(isNotNull(companies.website))
    .all();
  for (const row of companyRows) {
    const domain = normalizeDomain(row.website);
    if (!domain || !isGatedDomain(domain, PUBLIC_EMAIL_DOMAINS)) continue;
    const entry = map.get(domain) ?? {};
    entry.companyId ??= row.id;
    map.set(domain, entry);
  }

  return map;
}

/** Which of these Gmail message ids are already in `gmail_messages`. */
async function findExistingMessageIds(
  db: ReturnType<typeof drizzle>,
  messageIds: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (let i = 0; i < messageIds.length; i += D1_MAX_BOUND_PARAMS) {
    const slice = messageIds.slice(i, i + D1_MAX_BOUND_PARAMS);
    const rows = await db
      .select({ messageId: gmailMessages.messageId })
      .from(gmailMessages)
      .where(inArray(gmailMessages.messageId, slice))
      .all();
    for (const r of rows) existing.add(r.messageId);
  }
  return existing;
}

/** Recursively collect attachment parts (filename present) from a Gmail payload. */
function collectAttachmentParts(
  payload: GmailMessageFull["payload"],
): Array<{ filename: string; mimeType?: string; size?: number }> {
  const out: Array<{ filename: string; mimeType?: string; size?: number }> = [];
  const walk = (part: NonNullable<GmailMessageFull["payload"]> | undefined) => {
    if (!part) return;
    if (part.filename && part.filename.trim()) {
      out.push({
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body?.size,
      });
    }
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return out;
}

export interface IngestGateResult {
  domainsSearched: number;
  candidates: number;
  newMessages: number;
  processed: number;
  failed: number;
}

export interface RunIngestGateOptions {
  /**
   * Restrict the run to these domains only (case-insensitive, normalized).
   * Used for a bounded first run / ops re-pull of a single vendor. When omitted,
   * every gated domain is searched.
   */
  onlyDomains?: string[];
}

/**
 * Run the gate: search every gated domain, ingest new matches, and bridge each
 * into the shared `processEmail` pipeline.
 *
 * @param env  Worker env (Gmail auth, DB, R2, AI — all consumed downstream).
 */
export async function runIngestGate(
  env: Env,
  opts: RunIngestGateOptions = {},
): Promise<IngestGateResult> {
  const db = drizzle(env.DB);
  const token = await getGmailAccessToken(env);

  let domainMap = await collectGatedDomains(db);
  if (opts.onlyDomains && opts.onlyDomains.length > 0) {
    const allow = new Set(
      opts.onlyDomains.map((d) => normalizeDomain(d)).filter((d): d is string => Boolean(d)),
    );
    domainMap = new Map([...domainMap].filter(([domain]) => allow.has(domain)));
  }
  const result: IngestGateResult = {
    domainsSearched: domainMap.size,
    candidates: 0,
    newMessages: 0,
    processed: 0,
    failed: 0,
  };

  for (const [domain, match] of domainMap) {
    let hits;
    try {
      hits = await searchMessages(
        token,
        `from:@${domain} OR to:@${domain}`,
        MAX_NEW_MESSAGES_PER_DOMAIN,
      );
    } catch (err) {
      console.error(`[gmail/ingest-gate] search failed for ${domain}:`, err);
      continue;
    }
    result.candidates += hits.length;
    if (hits.length === 0) continue;

    const existing = await findExistingMessageIds(
      db,
      hits.map((h) => h.id),
    );
    const fresh = hits.filter((h) => !existing.has(h.id));

    for (const hit of fresh) {
      try {
        await ingestAndBridgeMessage(env, db, token, hit.id, match);
        result.newMessages += 1;
        result.processed += 1;
      } catch (err) {
        result.failed += 1;
        console.error(`[gmail/ingest-gate] message ${hit.id} failed:`, err);
      }
    }
  }

  return result;
}

/** The `general` catch-all decision — arbitrary vendor mail, AI decides the type. */
export const GATE_DECISION: RouteDecision = {
  routeId: "general",
  reason: "gmail-ingest-gate: domain matched a known showroom/company",
  profile: CATCH_ALL_PROFILE,
  // 0042 trust gate: Gmail is the user's personal mailbox — anyone can email it,
  // so run only the NON-AI work (text extraction + embeddings) and wait for the
  // user to approve before the AI reads/interprets the content.
  source: "gmail",
  deferAiUntilApproval: true,
};

/**
 * Ingest one matched Gmail message (thread/message/participant/attachment rows)
 * and bridge its raw RFC-822 into the shared `processEmail` pipeline.
 *
 * Recording is intentionally lean: attachment `md5`/`r2_key`/`ocr_text` stay
 * NULL here — `processEmail` re-parses the raw message and owns the actual
 * attachment OCR + persistence into the worker-email/materials tables. The
 * `gmail_message_attachments` rows are Gmail-side provenance + a stable
 * `rag_uuid`; back-filling their md5/OCR from the pipeline's output is a
 * documented 0039 follow-up.
 */
async function ingestAndBridgeMessage(
  env: Env,
  db: ReturnType<typeof drizzle>,
  token: string,
  gmailMessageId: string,
  match: DomainMatch,
): Promise<void> {
  const full = await getMessage(token, gmailMessageId);
  const extracted = extractMessage(full);

  // Thread row (idempotent upsert by native thread id).
  await db
    .insert(gmailThreads)
    .values({
      threadId: full.threadId,
      subject: extracted.subject ?? null,
      timestampSent: extracted.date ? new Date(extracted.date) : null,
    })
    .onConflictDoNothing()
    .run();

  // Message row.
  const ragUuid = crypto.randomUUID();
  const toRecipients = [...extracted.to, ...extracted.cc];
  const attachments = collectAttachmentParts(full.payload);
  // Deterministic FOLDER tagging (0041) — no AI. This only decides which inbox
  // folder (Spam/Receipts) a message shows in; it does NOT block ingestion.
  // Every gated message (spam included, per product intent) is still inserted
  // AND bridged into processEmail below, so receipts/invoices/contracts get the
  // full worker-email extraction regardless of this tag.
  const gate = classifyMessage({
    from: extracted.from ?? "",
    subject: extracted.subject ?? "",
    body: extracted.body,
    hasAttachments: attachments.length > 0,
  });
  const [inserted] = await db
    .insert(gmailMessages)
    .values({
      threadId: full.threadId,
      messageId: gmailMessageId,
      timestamp: extracted.date ? new Date(extracted.date) : null,
      fromRecipient: extracted.from ?? "",
      toRecipientsJson: JSON.stringify(toRecipients),
      subject: extracted.subject ?? null,
      body: extracted.body,
      bodyPlainTxt: extracted.body,
      bodyHtml: extracted.html,
      classification: gate.classification,
      isSpam: gate.isSpam,
      spamRationale: gate.spamRationale,
      ragUuid,
    })
    .onConflictDoNothing()
    .returning({ id: gmailMessages.id })
    .all();

  // A concurrent run may have won the message insert; re-resolve the row id.
  const messageRowId =
    inserted?.id ??
    (
      await db
        .select({ id: gmailMessages.id })
        .from(gmailMessages)
        .where(eq(gmailMessages.messageId, gmailMessageId))
        .limit(1)
        .all()
    )[0]?.id;
  if (!messageRowId) throw new Error(`could not resolve gmail_messages row for ${gmailMessageId}`);

  // Participant rows (from + to/cc), then stamp the matched domain's resolution
  // FKs onto whichever participants carry that domain.
  const rows = buildParticipantRows({
    messageId: messageRowId,
    threadId: full.threadId,
    from: extracted.from ?? "",
    toRecipients,
  });
  await insertParticipants(db, rows);
  await applyResolutionFks(db, messageRowId, match);

  // Attachment provenance (cheap metadata only; OCR is processEmail's job).
  for (const att of attachments) {
    const ext = att.filename.includes(".")
      ? att.filename.split(".").pop()?.toLowerCase() ?? null
      : null;
    await db
      .insert(gmailMessageAttachments)
      .values({
        gmailMessageId: messageRowId,
        ragUuid: crypto.randomUUID(),
        fileName: att.filename,
        fileExt: ext,
        fileMimetype: att.mimeType ?? null,
        fileSizeBytes: att.size ?? null,
      })
      .run();
  }

  // Bridge: raw RFC-822 → the shared pipeline (dedupes on worker_emails.message_id).
  // Dynamic import keeps the heavy pipeline out of the static worker graph.
  const { processEmail } = await import("@backend/services/email/pipeline");
  const rawEmail = await getRawMessage(token, gmailMessageId);
  await processEmail({
    messageId: extracted.messageIdHeader ?? gmailMessageId,
    rawEmail,
    from: extracted.from ?? "",
    to: extracted.to[0] ?? "justin@126colby.com",
    decision: GATE_DECISION,
    env,
  });
}

/**
 * Stamp the matched entity ids onto the participant rows whose email domain is
 * the one that matched. Contact resolution/creation (setting
 * `showroom_store_contact_id` / `contractor_business_contact_id`) is a 0039
 * Part D follow-up — this establishes the entity link now.
 */
async function applyResolutionFks(
  db: ReturnType<typeof drizzle>,
  messageRowId: number,
  match: DomainMatch,
): Promise<void> {
  if (match.showroomStoreId == null && match.companyId == null) return;
  const patch: { showroomStoreId?: number; contractorBusinessId?: number } = {};
  if (match.showroomStoreId != null) patch.showroomStoreId = match.showroomStoreId;
  if (match.companyId != null) patch.contractorBusinessId = match.companyId;
  await db
    .update(gmailMessageParticipants)
    .set(patch)
    .where(eq(gmailMessageParticipants.messageId, messageRowId))
    .run();
}
