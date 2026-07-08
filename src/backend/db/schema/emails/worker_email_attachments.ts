import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { workerEmails } from "./worker_emails";

/**
 * Worker Email Attachments — files attached to inbound emails.
 *
 * Binary content is stored in R2 (ARTIFACTS_BUCKET) at
 * `emails/{emailId}/{filename}`. This table holds metadata + the R2 key.
 */
export const workerEmailAttachments = sqliteTable(
  "worker_email_attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    emailId: integer("email_id")
      .notNull()
      .references(() => workerEmails.id, { onDelete: "cascade" }),

    /** Original filename from the MIME part (may be null for inline parts). */
    filename: text("filename"),

    /** MIME type (e.g. "application/pdf", "image/jpeg"). */
    mimeType: text("mime_type"),

    /** File size in bytes. */
    sizeBytes: integer("size_bytes"),

    /** R2 object key in ARTIFACTS_BUCKET. */
    r2Key: text("r2_key").notNull(),

    /**
     * UUID linking this attachment to its vector embedding in the
     * VECTOR_INDEX (Vectorize). Null until the content has been embedded.
     */
    ragUuid: text("rag_uuid"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    emailIdx: index("worker_email_attachments_email_idx").on(table.emailId),
  }),
);

export type WorkerEmailAttachment = typeof workerEmailAttachments.$inferSelect;
export type WorkerEmailAttachmentInsert = typeof workerEmailAttachments.$inferInsert;
