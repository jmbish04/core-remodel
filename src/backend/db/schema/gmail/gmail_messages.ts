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

    /**
     * Full message body content — always captured on ingestion.
     * Legacy single-body column, kept for back-compat. New ingestion also
     * populates the split `body_plain_txt` / `body_html` columns below.
     */
    body: text("body"),

    /** Plain-text body (0039). Preferred for md5 / classification input. */
    bodyPlainTxt: text("body_plain_txt"),
    /**
     * HTML body (0039). SANITIZED ON WRITE via sanitizeNoteHtml (0041 hardening)
     * at both ingest sites + the reply path — script/style/iframe/object/embed
     * tags, on* handlers, and javascript: URLs are stripped before storage, so
     * the column never holds active content. (The reading pane still renders
     * plaintext `bodyVisible`, not this.)
     */
    bodyHtml: text("body_html"),

    /** Optional Workers AI–generated summary of the message body. */
    aiSummary: text("ai_summary"),

    /**
     * Deterministic content classification (0041) — set at ingestion by a
     * pure text-pattern matcher, NO AI. Drives inbox foldering.
     *   normal      — ordinary correspondence (default).
     *   promotional — marketing blast (also sets is_spam=1).
     *   receipt|invoice|quote — a purchase document (routed to the receipt
     *     parser); shown in the Receipts folder.
     */
    classification: text("classification", {
      enum: ["normal", "promotional", "receipt", "invoice", "quote"],
    })
      .notNull()
      .default("normal"),

    /**
     * Spam flag (0041). Deterministic — set when the lowercased body matches a
     * known marketing/bulk phrase (see spam_rationale). Spam is still ingested
     * (so sale/deal blasts and app-health checks remain visible) but lands in
     * the inbox's Spam folder instead of the main list.
     */
    isSpam: integer("is_spam", { mode: "boolean" }).notNull().default(false),

    /**
     * Why is_spam was set — the exact phrase that matched (e.g. "unsubscribe").
     * Auto-generated from the pattern hit, NOT AI. NULL when not spam.
     */
    spamRationale: text("spam_rationale"),

    /** Soft-delete (0041). NULL = live; set = in Trash. */
    deletedAt: integer("deleted_at", { mode: "timestamp" }),

    /**
     * Whether this message's embedded (cid:) images have been extracted +
     * uploaded to Cloudflare Images yet (0041). Guards the on-view upload so a
     * message is fetched from Gmail + uploaded at most once, even when it has
     * no inline images (true = checked, regardless of how many were found).
     */
    imagesExtracted: integer("images_extracted", { mode: "boolean" })
      .notNull()
      .default(false),

    /**
     * UUID used as the Vectorize vector id for this message's body embedding.
     * Vectorize metadata stored alongside the vector: `{ rag_uuid, message_id, thread_id }`.
     */
    ragUuid: text("rag_uuid").notNull(),

    /**
     * When this message was marked read (0040 P4). NULL = unread. Single-user
     * system, so a per-message timestamp is enough — no per-user join table. The
     * migration backfills existing rows to created_at (historical = read) so the
     * showroom inbox badge doesn't light up for the entire back-catalogue.
     */
    readAt: integer("read_at", { mode: "timestamp" }),

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
