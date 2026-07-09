/**
 * @fileoverview Gmail Comms Hub — message participant extraction + indexed
 * company↔thread matching (0013 roadmap follow-up).
 *
 * `gmail_message_participants` (see
 * `src/backend/db/schema/gmail/gmail_message_participants.ts`) is the indexed
 * matching layer that resolves company↔thread relationships without an
 * unindexed `LIKE '%@domain%'` table scan. This module is the single source
 * of truth for:
 *
 *   1. `PUBLIC_EMAIL_DOMAINS` — the set of public/consumer providers where
 *      domain-wide matching is unsafe (see the constant's docstring). Both
 *      `ingestion.ts` (Gmail search-query construction) and
 *      `src/backend/api/routes/gmail.ts` (company↔thread matching) import
 *      this from here — there is exactly one copy of this list in the repo.
 *
 *   2. `parseEmailAddress` — normalizes a raw `From`/`To`/`Cc` header value
 *      (which may be `"Display Name <addr@domain.com>"` or a bare address)
 *      into a lowercased `{ email, domain }` pair, or `null` if it isn't a
 *      well-formed single address.
 *
 *   3. `buildParticipantRows` — turns one ingested message's `from` header +
 *      `to`/`cc` recipient list into deduped `gmail_message_participants`
 *      insert rows (role "from" for the sender, role "to" for every
 *      recipient — cc is folded into "to" for matching purposes, matching
 *      how `toRecipientsJson` already merges to+cc on `gmail_messages`).
 *
 *   4. `insertParticipants` — chunked, idempotent (`onConflictDoNothing()`,
 *      backed by the `(message_id, email, role)` unique index) bulk insert,
 *      safe to call repeatedon the same message (ingestion retries, manual
 *      backfill re-runs, etc).
 *
 * MATCHING RULE (see gmail_message_participants.ts + gmail.ts for the
 * consuming query): a contractor may use a PRIVATE domain (match by
 * `domain` — catches every POC at that company, even ones we've never seen
 * a contact record for) OR a PUBLIC provider like gmail/hotmail/yahoo
 * (domain matching there is too broad — millions of unrelated people share
 * the domain — so we match the EXACT `email` instead). A company can have
 * multiple contact emails across multiple domains, some private and some
 * public; matching is a UNION across all of them.
 */

import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { gmailMessageParticipants } from "@backend/db";
import type { GmailMessageParticipantInsert } from "@backend/db";

/**
 * Public/consumer email providers — NEVER used for domain-wide matching
 * (ingestion's Gmail search-query construction, and the company↔thread
 * matching query in `routes/gmail.ts`), even when every contact for a
 * company happens to share one. Domain-wide matching (`domain = 'gmail.com'`
 * or `from:@gmail.com OR to:@gmail.com`) is only safe for a company's own
 * private domain; if the "shared domain" were e.g. `gmail.com`, it would
 * match — and surface — every email in the user's ENTIRE mailbox to/from
 * any Gmail address, leaking unrelated private correspondence into a single
 * company's thread history. When a contact's domain is public we always
 * fall back to exact-address matching instead.
 *
 * This is the single source of truth for this set — `ingestion.ts` and
 * `routes/gmail.ts` both import it from here rather than keeping their own
 * copies in sync by hand.
 */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "mail.com",
  "zoho.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "yandex.com",
  "comcast.net",
  "att.net",
  "verizon.net",
]);

/** D1's hard limit on bound parameters per statement (see documents/db-helpers.ts). */
const D1_MAX_BOUND_PARAMS = 100;

/** Rows per db.batch of single-row participant inserts (one round-trip per batch). */
const PARTICIPANT_INSERT_BATCH = 50;

export interface ParsedEmailAddress {
  /** Lowercased bare email address (no display name / angle brackets). */
  email: string;
  /** Lowercased domain portion (the part after "@"). */
  domain: string;
}

/**
 * Parse a raw `From`/`To`/`Cc` header value into a normalized
 * `{ email, domain }` pair.
 *
 * Accepts either RFC-2822-style `"Display Name <addr@domain.com>"` or a bare
 * `"addr@domain.com"`. Returns `null` if the value doesn't resolve to
 * exactly one well-formed address (empty input, missing/multiple "@",
 * empty local-part, or empty domain-part).
 */
export function parseEmailAddress(raw: string): ParsedEmailAddress | null {
  if (!raw) return null;

  const trimmedRaw = raw.trim();
  if (!trimmedRaw) return null;

  // Prefer the address inside angle brackets when present (display-name
  // form); otherwise treat the whole trimmed value as the address.
  const angleMatch = trimmedRaw.match(/<([^<>]+)>/);
  const candidate = (angleMatch ? angleMatch[1] : trimmedRaw).trim().toLowerCase();

  if (!candidate) return null;

  const atCount = (candidate.match(/@/g) ?? []).length;
  if (atCount !== 1) return null;

  const [local, domain] = candidate.split("@");
  if (!local || !domain) return null;

  // A domain must have at least one "." to be plausible (rules out stray
  // fragments like "joe@localhost" slipping through as a matchable domain).
  if (!domain.includes(".")) return null;

  return { email: candidate, domain };
}

export interface BuildParticipantRowsInput {
  /** DB `id` of the parent `gmail_messages` row (FK target). */
  messageId: number;
  /** Gmail-native thread id (denormalized onto every participant row). */
  threadId: string;
  /** Raw `From` header value. */
  from: string;
  /** Raw `To` + `Cc` recipient values (already split, one address each). */
  toRecipients: string[];
}

/**
 * Build deduped `gmail_message_participants` insert rows for one ingested
 * message: the sender (`role: "from"`) and every recipient (`role: "to"` —
 * `to`/`cc` are folded together, matching how `gmail_messages.toRecipientsJson`
 * already merges them for storage). Unparseable addresses are dropped
 * silently (best-effort provenance data, not a hard ingestion requirement).
 * Deduped on `(email, role)` since the unique index is
 * `(message_id, email, role)` and a header can legitimately repeat an
 * address (e.g. the same person in both To and Cc).
 */
export function buildParticipantRows(
  input: BuildParticipantRowsInput,
): GmailMessageParticipantInsert[] {
  const { messageId, threadId, from, toRecipients } = input;

  const seen = new Set<string>();
  const rows: GmailMessageParticipantInsert[] = [];

  const pushRow = (raw: string, role: "from" | "to") => {
    const parsed = parseEmailAddress(raw);
    if (!parsed) return;
    const dedupeKey = `${role}:${parsed.email}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    rows.push({
      messageId,
      threadId,
      email: parsed.email,
      domain: parsed.domain,
      role,
    });
  };

  pushRow(from, "from");
  for (const recipient of toRecipients) pushRow(recipient, "to");

  return rows;
}

/**
 * Chunked, idempotent bulk insert of `gmail_message_participants` rows.
 * Uses `.onConflictDoNothing()` (backed by the `(message_id, email, role)`
 * unique index) so re-running ingestion or the backfill endpoint over
 * already-populated messages is always safe — no duplicate rows, no thrown
 * conflict errors.
 *
 * Uses chunked `db.batch()` of single-row statements (`PARTICIPANT_INSERT_BATCH`
 * per batch) — one round-trip per batch, each statement far under D1's 100
 * bound-parameter cap, and idempotent via `onConflictDoNothing`.
 */
export async function insertParticipants(
  db: ReturnType<typeof drizzle>,
  rows: GmailMessageParticipantInsert[],
): Promise<void> {
  if (rows.length === 0) return;

  // Insert via chunked db.batch of single-row statements (the repo's D1
  // bulk-write convention): one batch = one round-trip for up to 50 rows, each
  // statement well under D1's 100 bound-param cap, all idempotent.
  for (let i = 0; i < rows.length; i += PARTICIPANT_INSERT_BATCH) {
    const stmts = rows
      .slice(i, i + PARTICIPANT_INSERT_BATCH)
      .map((row) => db.insert(gmailMessageParticipants).values(row).onConflictDoNothing());
    if (stmts.length === 0) continue;
    await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  }
}

/**
 * Split a set of candidate raw addresses (e.g. `companies.email` +
 * every `company_contacts` contact email for a company) into the two
 * matching strategies described in the module docstring: private domains
 * (match by `domain`) and public-provider exact addresses (match by
 * `email`). Unparseable addresses are dropped.
 */
export function splitCandidateEmails(rawEmails: string[]): {
  privateDomains: string[];
  publicEmails: string[];
} {
  const privateDomains = new Set<string>();
  const publicEmails = new Set<string>();

  for (const raw of rawEmails) {
    const parsed = parseEmailAddress(raw);
    if (!parsed) continue;
    if (PUBLIC_EMAIL_DOMAINS.has(parsed.domain)) {
      publicEmails.add(parsed.email);
    } else {
      privateDomains.add(parsed.domain);
    }
  }

  return {
    privateDomains: Array.from(privateDomains),
    publicEmails: Array.from(publicEmails),
  };
}

/**
 * Chunk an array into groups of at most `size` — shared helper for
 * respecting D1's bound-parameter cap on `inArray`/`IN` queries built from
 * `privateDomains`/`publicEmails`.
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Resolve every distinct `threadId` touched by any of the given private
 * domains (matched against `gmail_message_participants.domain`) or public
 * exact emails (matched against `.email`), via the indexed columns — no
 * `LIKE` scan. Either input list may be empty (the corresponding branch is
 * skipped); if both are empty, returns an empty array.
 */
export async function findThreadIdsByParticipants(
  db: ReturnType<typeof drizzle>,
  input: { privateDomains: string[]; publicEmails: string[] },
): Promise<string[]> {
  const { privateDomains, publicEmails } = input;

  // The chunked lookups are independent — run them concurrently.
  const domainChunks = chunkArray(privateDomains, D1_MAX_BOUND_PARAMS).filter(
    (chunk) => chunk.length > 0,
  );
  const emailChunks = chunkArray(publicEmails, D1_MAX_BOUND_PARAMS).filter(
    (chunk) => chunk.length > 0,
  );

  const queries = [
    ...domainChunks.map((chunk) =>
      db
        .select({ threadId: gmailMessageParticipants.threadId })
        .from(gmailMessageParticipants)
        .where(inArray(gmailMessageParticipants.domain, chunk))
        .all(),
    ),
    ...emailChunks.map((chunk) =>
      db
        .select({ threadId: gmailMessageParticipants.threadId })
        .from(gmailMessageParticipants)
        .where(inArray(gmailMessageParticipants.email, chunk))
        .all(),
    ),
  ];

  const results = await Promise.all(queries);
  const threadIds = new Set<string>();
  for (const rows of results) {
    for (const row of rows) threadIds.add(row.threadId);
  }

  return Array.from(threadIds);
}
