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
 * shares one domain we use that compact form; otherwise we OR together each
 * contact's exact address, on both `from:` and `to:` so replies TO the
 * contractor (sent by justin@126colby.com) are captured too.
 */
function buildCompanySearchQuery(emails: string[]): string | null {
  const cleaned = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length === 0) return null;

  const domains = new Set(
    cleaned.map((e) => e.split("@")[1]).filter((d): d is string => Boolean(d)),
  );

  if (domains.size === 1) {
    const [domain] = domains;
    return `from:@${domain} OR to:@${domain}`;
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
    })) as { data: number[][] };

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

    for (const { id: messageId } of newResults) {
      let full;
      try {
        full = await getMessage(token, messageId);
      } catch (err) {
        console.error(`[gmail/ingestion] getMessage failed for ${messageId}:`, err);
        continue;
      }

      const extracted = extractMessage(full);
      const nativeThreadId = full.threadId;
      const timestamp = resolveMessageTimestamp(extracted.date, full.internalDate);

      // Upsert the thread row: create if missing; otherwise bump
      // subject/timestampSent/companyId only when this message is newer.
      const [existingThread] = await db
        .select()
        .from(gmailThreads)
        .where(eq(gmailThreads.threadId, nativeThreadId))
        .limit(1);

      if (!existingThread) {
        await db
          .insert(gmailThreads)
          .values({
            threadId: nativeThreadId,
            subject: extracted.subject || null,
            timestampSent: timestamp,
            companyId,
          })
          .onConflictDoNothing()
          .run();
        threadsTouched++;
      } else {
        const isNewer =
          !existingThread.timestampSent || timestamp > existingThread.timestampSent;
        if (isNewer) {
          await db
            .update(gmailThreads)
            .set({
              subject: extracted.subject || existingThread.subject,
              timestampSent: timestamp,
              companyId: existingThread.companyId ?? companyId,
              updatedAt: new Date(),
            })
            .where(eq(gmailThreads.threadId, nativeThreadId))
            .run();
        }
      }

      const ragUuid = crypto.randomUUID();

      try {
        await db
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
          .onConflictDoNothing()
          .run();
        messagesIngested++;
      } catch (err) {
        console.error(`[gmail/ingestion] failed to insert message ${messageId}:`, err);
        continue;
      }

      await embedMessage(env, ragUuid, messageId, nativeThreadId, extracted.body);
    }
  }

  return {
    companies: companiesWithEmails.length,
    threads: threadsTouched,
    messages: messagesIngested,
  };
}
