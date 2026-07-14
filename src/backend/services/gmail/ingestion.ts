/**
 * @fileoverview Gmail Comms Hub — ingestion (cron + manual trigger).
 *
 * For each contractor company that has contacts with email addresses, build
 * a Gmail search query from those addresses (or, if all contacts share one
 * domain, a domain-wide query), search Gmail, dedupe against already-ingested
 * messages, persist full thread/message content to D1, and embed each
 * message body into Vectorize for RAG grounding.
 *
 * Bounded per run: `MAX_NEW_MESSAGES_PER_COMPANY` caps how many *new* Gmail
 * messages are processed per company per invocation, so a single cron tick
 * (or manual `/api/gmail/ingest` call) stays well inside Workers' CPU/time
 * budgets even for companies with large mail histories. Subsequent ticks
 * pick up where the previous one left off (dedupe is by `message_id`, not by
 * an offset/cursor).
 */

import type { BatchItem } from "drizzle-orm/batch";
import { and, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  companies,
  companyContacts,
  contacts,
  gmailMessages,
  gmailThreads,
} from "@backend/db";

import { getGmailAccessToken } from "./auth";
import { extractMessage, getMessage, searchMessages } from "./client";
import { PUBLIC_EMAIL_DOMAINS, buildParticipantRows, insertParticipants } from "./participants";

/** D1's hard limit on bound parameters per statement (see documents/db-helpers.ts). */
const D1_MAX_BOUND_PARAMS = 100;

/** Cap on new messages ingested per company per run — keeps cron ticks bounded. */
const MAX_NEW_MESSAGES_PER_COMPANY = 25;

/** Embedding: chunk size + cap per message body. */
const EMBED_CHUNK_CHARS = 1000;
const EMBED_MAX_CHUNKS = 10;

export interface IngestCompanyEmailsResult {
  companies: number;
  threads: number;
  messages: number;
}

/**
 * Build the Gmail search query for a company's contact email addresses.
 *
 * Gmail search DOES support `from:@domain.com` / `to:@domain.com` as a
 * domain-scoped match (the `@` prefix on a bare domain, no wildcard needed —
 * `from:*@domain.com` is NOT valid Gmail search syntax). When every contact
 * shares one PRIVATE domain we use that compact form; otherwise (multiple
 * domains, OR the shared domain is a public/consumer provider — see
 * `PUBLIC_EMAIL_DOMAINS` above) we OR together each contact's exact address,
 * on both `from:` and `to:` so replies TO the contractor (sent by
 * justin@126colby.com) are captured too.
 */
function buildCompanySearchQuery(emails: string[]): string | null {
  const cleaned = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length === 0) return null;

  const domains = new Set(
    cleaned.map((e) => e.split("@")[1]).filter((d): d is string => Boolean(d)),
  );

  if (domains.size === 1) {
    const [domain] = domains;
    if (!PUBLIC_EMAIL_DOMAINS.has(domain)) {
      return `from:@${domain} OR to:@${domain}`;
    }
  }

  const clauses = cleaned.map((email) => `(from:${email} OR to:${email})`);
  return clauses.join(" OR ");
}

/** Chunk an array into groups of at most `size` (used for D1 `inArray` chunking). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Batch-select which of the given Gmail message ids already exist in `gmail_messages`. */
async function findExistingMessageIds(
  db: ReturnType<typeof drizzle>,
  messageIds: string[],
): Promise<Set<string>> {
  const existing = new Set<string>();
  for (const idsChunk of chunk(messageIds, D1_MAX_BOUND_PARAMS)) {
    const rows = await db
      .select({ messageId: gmailMessages.messageId })
      .from(gmailMessages)
      .where(inArray(gmailMessages.messageId, idsChunk))
      .all();
    for (const row of rows) existing.add(row.messageId);
  }
  return existing;
}

/** Batch-select existing gmail_threads rows for the given native thread ids. */
async function findExistingThreads(
  db: ReturnType<typeof drizzle>,
  threadIds: string[],
): Promise<Map<string, typeof gmailThreads.$inferSelect>> {
  const byThreadId = new Map<string, typeof gmailThreads.$inferSelect>();
  for (const idsChunk of chunk(threadIds, D1_MAX_BOUND_PARAMS)) {
    const rows = await db
      .select()
      .from(gmailThreads)
      .where(inArray(gmailThreads.threadId, idsChunk))
      .all();
    for (const row of rows) byThreadId.set(row.threadId, row);
  }
  return byThreadId;
}

/** D1/Workers-safe chunked `db.batch()` — a single round-trip per chunk of statements. */
async function runBatched(
  db: ReturnType<typeof drizzle>,
  statements: BatchItem<"sqlite">[],
  batchSize = 50,
): Promise<void> {
  for (let i = 0; i < statements.length; i += batchSize) {
    const slice = statements.slice(i, i + batchSize);
    if (slice.length === 0) continue;
    // `db.batch` requires a non-empty tuple type at the type level; the
    // length check above guarantees that at runtime, so this cast is safe.
    await db.batch(slice as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  }
}

/** Parse a Gmail `Date` header (RFC-2822-ish) or `internalDate` (epoch ms string) into a Date. */
function resolveMessageTimestamp(dateHeader: string, internalDate?: string): Date {
  if (internalDate) {
    const ms = Number(internalDate);
    if (Number.isFinite(ms)) return new Date(ms);
  }
  const parsed = dateHeader ? new Date(dateHeader) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed;
  return new Date();
}

/** Split a body into up-to-`EMBED_MAX_CHUNKS` chunks of ~`EMBED_CHUNK_CHARS` chars each. */
function chunkBodyForEmbedding(body: string): string[] {
  if (!body) return [];
  const chunks: string[] = [];
  for (let i = 0; i < body.length && chunks.length < EMBED_MAX_CHUNKS; i += EMBED_CHUNK_CHARS) {
    chunks.push(body.slice(i, i + EMBED_CHUNK_CHARS));
  }
  return chunks;
}

/** Embed + upsert a message's body chunks into Vectorize. Non-fatal on failure (logs, continues). */
async function embedMessage(
  env: Env,
  ragUuid: string,
  messageId: string,
  threadId: string,
  body: string,
): Promise<void> {
  const chunks = chunkBodyForEmbedding(body);
  if (chunks.length === 0) return;

  try {
    const result = (await env.AI.run("@cf/baai/bge-large-en-v1.5", {
      text: chunks,
      gateway: { id: env.AI_GATEWAY_ID },
    } as Parameters<typeof env.AI.run>[1])) as { data: number[][] };

    const vectors = (result.data ?? [])
      .map((values, i) => ({
        id: `gmail:${ragUuid}:${i}`,
        values,
        metadata: {
          kind: "gmail",
          rag_uuid: ragUuid,
          message_id: messageId,
          thread_id: threadId,
        },
      }))
      .filter((v) => Array.isArray(v.values) && v.values.length > 0);

    if (vectors.length > 0) {
      await env.VECTOR_INDEX.upsert(vectors);
    }
  } catch (err) {
    console.error(
      `[gmail/ingestion] embedding failed for message ${messageId} (rag_uuid=${ragUuid}):`,
      err,
    );
  }
}

interface CompanyWithEmails {
  companyId: number;
  emails: string[];
}

/** Load every non-archived company that has at least one contact with a non-empty email. */
async function loadCompaniesWithContactEmails(
  db: ReturnType<typeof drizzle>,
): Promise<CompanyWithEmails[]> {
  const rows = await db
    .select({
      companyId: companyContacts.companyId,
      email: contacts.email,
    })
    .from(companyContacts)
    .innerJoin(contacts, eq(companyContacts.contactId, contacts.id))
    .innerJoin(companies, eq(companyContacts.companyId, companies.id))
    .where(
      and(
        eq(companies.isArchived, false),
        isNotNull(contacts.email),
        ne(contacts.email, ""),
      ),
    )
    .all();

  const byCompany = new Map<number, string[]>();
  for (const row of rows) {
    if (!row.email) continue;
    const list = byCompany.get(row.companyId) ?? [];
    list.push(row.email);
    byCompany.set(row.companyId, list);
  }

  return [...byCompany.entries()].map(([companyId, emails]) => ({ companyId, emails }));
}

/**
 * Ingest new Gmail messages for every contractor company, deduped and capped
 * per the module constants above. Returns coarse counts for observability.
 */
export async function ingestCompanyEmails(env: Env): Promise<IngestCompanyEmailsResult> {
  const db = drizzle(env.DB);
  const companiesWithEmails = await loadCompaniesWithContactEmails(db);

  let threadsTouched = 0;
  let messagesIngested = 0;

  if (companiesWithEmails.length === 0) {
    return { companies: 0, threads: 0, messages: 0 };
  }

  const token = await getGmailAccessToken(env);

  for (const { companyId, emails } of companiesWithEmails) {
    const query = buildCompanySearchQuery(emails);
    if (!query) continue;

    let searchResults: { id: string; threadId: string }[] = [];
    try {
      searchResults = await searchMessages(token, query);
    } catch (err) {
      console.error(`[gmail/ingestion] search failed for company ${companyId}:`, err);
      continue;
    }

    if (searchResults.length === 0) continue;

    const candidateIds = searchResults.map((r) => r.id);
    const existingIds = await findExistingMessageIds(db, candidateIds);
    const newResults = searchResults
      .filter((r) => !existingIds.has(r.id))
      .slice(0, MAX_NEW_MESSAGES_PER_COMPANY);

    if (newResults.length === 0) continue;

    // Fetch full message bodies first (network I/O), then batch every DB
    // write for this company's new messages into chunked db.batch() calls —
    // one round-trip per chunk instead of one per message.
    const fetched: { messageId: string; full: Awaited<ReturnType<typeof getMessage>> }[] = [];
    for (const { id: messageId } of newResults) {
      try {
        const full = await getMessage(token, messageId);
        fetched.push({ messageId, full });
      } catch (err) {
        console.error(`[gmail/ingestion] getMessage failed for ${messageId}:`, err);
      }
    }

    if (fetched.length === 0) continue;

    const nativeThreadIds = [...new Set(fetched.map((f) => f.full.threadId))];
    const existingThreadsByThreadId = await findExistingThreads(db, nativeThreadIds);

    const threadStatements: BatchItem<"sqlite">[] = [];
    const messageStatements: BatchItem<"sqlite">[] = [];
    const toEmbed: { ragUuid: string; messageId: string; nativeThreadId: string; body: string }[] =
      [];
    const toParticipants: {
      messageId: string;
      nativeThreadId: string;
      from: string;
      toRecipients: string[];
    }[] = [];

    for (const { messageId, full } of fetched) {
      const extracted = extractMessage(full);
      const nativeThreadId = full.threadId;
      const timestamp = resolveMessageTimestamp(extracted.date, full.internalDate);

      // Upsert the thread row: create if missing; otherwise bump
      // subject/timestampSent/companyId only when this message is newer.
      // `existingThreadsByThreadId` is updated in-memory as we go so multiple
      // new messages in the same thread within this batch don't double-insert.
      const existingThread = existingThreadsByThreadId.get(nativeThreadId);

      if (!existingThread) {
        threadStatements.push(
          db
            .insert(gmailThreads)
            .values({
              threadId: nativeThreadId,
              subject: extracted.subject || null,
              timestampSent: timestamp,
              companyId,
            })
            .onConflictDoNothing(),
        );
        threadsTouched++;
        existingThreadsByThreadId.set(nativeThreadId, {
          id: 0,
          threadId: nativeThreadId,
          subject: extracted.subject || null,
          timestampSent: timestamp,
          companyId,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } else {
        const isNewer =
          !existingThread.timestampSent || timestamp > existingThread.timestampSent;
        if (isNewer) {
          threadStatements.push(
            db
              .update(gmailThreads)
              .set({
                subject: extracted.subject || existingThread.subject,
                timestampSent: timestamp,
                companyId: existingThread.companyId ?? companyId,
                updatedAt: new Date(),
              })
              .where(eq(gmailThreads.threadId, nativeThreadId)),
          );
          existingThreadsByThreadId.set(nativeThreadId, {
            ...existingThread,
            timestampSent: timestamp,
          });
        }
      }

      const ragUuid = crypto.randomUUID();
      messageStatements.push(
        db
          .insert(gmailMessages)
          .values({
            threadId: nativeThreadId,
            messageId,
            timestamp,
            fromRecipient: extracted.from,
            toRecipientsJson: JSON.stringify([...extracted.to, ...extracted.cc]),
            subject: extracted.subject || null,
            body: extracted.body,
            ragUuid,
          })
          .onConflictDoNothing(),
      );
      messagesIngested++;
      toEmbed.push({ ragUuid, messageId, nativeThreadId, body: extracted.body });
      toParticipants.push({
        messageId,
        nativeThreadId,
        from: extracted.from,
        toRecipients: [...extracted.to, ...extracted.cc],
      });
    }

    try {
      await runBatched(db, [...threadStatements, ...messageStatements]);
    } catch (err) {
      console.error(`[gmail/ingestion] batched write failed for company ${companyId}:`, err);
      continue;
    }

    for (const item of toEmbed) {
      await embedMessage(env, item.ragUuid, item.messageId, item.nativeThreadId, item.body);
    }

    // Populate gmail_message_participants for every message just written
    // (whether the .onConflictDoNothing() insert was new or a no-op because
    // the message already existed — either way, look up the DB `id` by the
    // Gmail-native messageId, which is unique-indexed, and derive participant
    // rows. Resilient by design: a failure here must never break ingestion
    // itself, since these rows are a derived matching index, not primary
    // data. If a message somehow can't be found post-batch (shouldn't
    // happen — the batch either inserted it or it already existed), it's
    // silently skipped; the `/backfill-participants` endpoint sweeps up any
    // gaps.
    try {
      const gmailMessageIds = toParticipants.map((p) => p.messageId);
      const idByMessageId = new Map<string, number>();
      for (let i = 0; i < gmailMessageIds.length; i += D1_MAX_BOUND_PARAMS) {
        const idsChunk = gmailMessageIds.slice(i, i + D1_MAX_BOUND_PARAMS);
        const rows = await db
          .select({ id: gmailMessages.id, messageId: gmailMessages.messageId })
          .from(gmailMessages)
          .where(inArray(gmailMessages.messageId, idsChunk))
          .all();
        for (const row of rows) idByMessageId.set(row.messageId, row.id);
      }

      const participantRows = toParticipants.flatMap((item) => {
        const dbId = idByMessageId.get(item.messageId);
        if (dbId === undefined) return [];
        return buildParticipantRows({
          messageId: dbId,
          threadId: item.nativeThreadId,
          from: item.from,
          toRecipients: item.toRecipients,
        });
      });

      await insertParticipants(db, participantRows);
    } catch (err) {
      console.error(
        `[gmail/ingestion] participant indexing failed for company ${companyId}:`,
        err,
      );
    }
  }

  return {
    companies: companiesWithEmails.length,
    threads: threadsTouched,
    messages: messagesIngested,
  };
}
