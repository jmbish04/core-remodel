import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { companies } from "../directory/companies";

/**
 * Gmail Comms Hub — Threads
 *
 * One row per Gmail-native thread ingested for a contractor company inbox.
 * `threadId` is the Gmail API's native thread identifier (not our surrogate
 * `id`); `gmail_messages.threadId` also references this native value directly,
 * per spec — there is intentionally no FK to `id` here.
 */
export const gmailThreads = sqliteTable(
  "gmail_threads",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Gmail-native thread id (e.g. from the Gmail API `threads.list` response). */
    threadId: text("thread_id").notNull(),

    subject: text("subject"),

    /** Timestamp of the latest message in the thread; drives inbox ordering. */
    timestampSent: integer("timestamp_sent", { mode: "timestamp" }),

    /**
     * Contractor company this thread was matched to during ingestion.
     * No FK cascade — set null on company deletion rather than fan out.
     */
    companyId: integer("company_id").references(() => companies.id, {
      onDelete: "set null",
    }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    threadIdUnique: uniqueIndex("gmail_threads_thread_id_unique").on(table.threadId),
    companyIdx: index("gmail_threads_company_id_idx").on(table.companyId),
  }),
);

export type GmailThread = typeof gmailThreads.$inferSelect;
export type GmailThreadInsert = typeof gmailThreads.$inferInsert;
