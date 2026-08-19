import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { gmailMessages } from "./gmail_messages";

/**
 * Gmail Comms Hub — Message Attachments (0039)
 *
 * One row per file attached to an ingested Gmail message. Rows are created by
 * the ingest gate at recording time with only the cheap, header-derived fields
 * populated (`file_*`, `md5`, `r2_key`). The expensive, spend-bearing fields
 * (`ocr_text`, `ai_summary`, `ai_confidence`, `ai_metadata`, `remodel_doc_type`)
 * stay NULL until a message actually reaches the processing pipeline — either
 * because its domain matched a known showroom/company, or because the user
 * filed it under a managed Gmail label. This keeps the gate itself at zero
 * AI/OCR cost.
 *
 * `md5` is change-detection: if a re-fetched message yields an attachment whose
 * md5 differs from the recorded one, the row is re-evaluated rather than
 * silently trusted.
 */
export const gmailMessageAttachments = sqliteTable(
  "gmail_message_attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK to gmail_messages.id — cascades on delete for provenance cleanup. */
    gmailMessageId: integer("gmail_message_id")
      .notNull()
      .references(() => gmailMessages.id, { onDelete: "cascade" }),

    /**
     * UUID appended to the Vectorize vector id so an embedding of this
     * attachment's OCR text can be matched back to this exact document.
     * Assigned at record time (before any OCR), so it is always present.
     */
    ragUuid: text("rag_uuid").notNull(),

    fileName: text("file_name"),
    /** Lowercased extension without the dot (e.g. "pdf"). Derived from fileName. */
    fileExt: text("file_ext"),
    fileMimetype: text("file_mimetype"),
    fileSizeBytes: integer("file_size_bytes"),

    /** md5 of the raw attachment bytes — dedup + change-detection. */
    md5: text("md5"),

    /** ARTIFACTS_BUCKET object key once the bytes are persisted to R2. */
    r2Key: text("r2_key"),

    /** Extracted text (liteparse / AI.toMarkdown). NULL until processed. */
    ocrText: text("ocr_text"),

    /** Structured AI summary (JSON). NULL until processed. */
    aiSummary: text("ai_summary", { mode: "json" }),
    /**
     * Model confidence 0–1 for the doc-type classification. A real column
     * (not JSON) so it can be sorted/thresholded directly. NULL until processed.
     */
    aiConfidence: real("ai_confidence"),
    /** Arbitrary structured extraction metadata (JSON). NULL until processed. */
    aiMetadata: text("ai_metadata", { mode: "json" }),

    /**
     * What kind of remodel document this attachment is, once classified.
     * TEXT + drizzle enum (D1 has no CHECK), so adding a value needs no
     * migration. NULL until processed.
     */
    remodelDocType: text("remodel_doc_type", {
      enum: [
        "INVOICE",
        "RECEIPT",
        "QUOTE",
        "CONTRACT",
        "CHANGE_ORDER",
        "SPEC_SHEET",
        "PRICE_LIST",
        "OTHER",
      ],
    }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    messageIdx: index("gmail_message_attachments_message_id_idx").on(table.gmailMessageId),
    ragUuidUnique: uniqueIndex("gmail_message_attachments_rag_uuid_unique").on(table.ragUuid),
    docTypeIdx: index("gmail_message_attachments_doc_type_idx").on(table.remodelDocType),
  }),
);

export type GmailMessageAttachment = typeof gmailMessageAttachments.$inferSelect;
export type GmailMessageAttachmentInsert = typeof gmailMessageAttachments.$inferInsert;
