import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Gmail Comms Hub — Messages
 *
 * One row per individual Gmail message ingested for a contractor company
 * inbox. Full body content is always captured (never a summary-only row).
 *
 * `threadId` intentionally references the Gmail-NATIVE thread id
 * (`gmail_threads.threadId`), NOT `gmail_threads.id` — per spec there is no
 * FK here, just a plain index, since ingestion may see messages before their
 * parent thread row is persisted.
 */
export const gmailMessages = sqliteTable(
  "gmail_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Gmail-native thread id (matches gmail_threads.threadId; not FK'd). */
    threadId: text("thread_id").notNull(),

    /** Gmail-native message id. */
    messageId: text("message_id").notNull(),

    timestamp: integer("timestamp", { mode: "timestamp" }),

    fromRecipient: text("from_recipient").notNull(),

    /**
     * JSON-encoded string[] of "to" recipient email addresses.
     * Shape: `["someone@example.com", "other@example.com"]`
     */
    toRecipientsJson: text("to_recipients_json").notNull(),

    subject: text("subject"),

    /** Full message body content — always captured on ingestion. */
    body: text("body"),

    /** Optional Workers AI–generated summary of the message body. */
    aiSummary: text("ai_summary"),

    /**
     * UUID used as the Vectorize vector id for this message's body embedding.
     * Vectorize metadata stored alongside the vector: `{ rag_uuid, message_id, thread_id }`.
     */
    ragUuid: text("rag_uuid").notNull(),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    messageIdUnique: uniqueIndex("gmail_messages_message_id_unique").on(table.messageId),
    ragUuidUnique: uniqueIndex("gmail_messages_rag_uuid_unique").on(table.ragUuid),
    threadIdx: index("gmail_messages_thread_id_idx").on(table.threadId),
    fromRecipientIdx: index("gmail_messages_from_recipient_idx").on(table.fromRecipient),
  }),
);

export type GmailMessage = typeof gmailMessages.$inferSelect;
export type GmailMessageInsert = typeof gmailMessages.$inferInsert;
