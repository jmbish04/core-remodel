import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { gmailMessages } from "./gmail_messages";

/**
 * Gmail Comms Hub — Embedded (inline) images (0041)
 *
 * One row per image embedded IN the body of an ingested Gmail message (a
 * `cid:` inline reference), NOT a downloadable attachment — those live in
 * `gmail_message_attachments`. At ingestion the image bytes are uploaded to
 * Cloudflare Images (`ImageProcessorService.uploadToCloudflareImages`) and the
 * served delivery URL is stored here, so the reading pane can render the body
 * with the original `cid:` refs rewritten to `delivery_url`.
 */
export const gmailMessageImages = sqliteTable(
  "gmail_message_images",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK to gmail_messages.id — cascades on delete. */
    gmailMessageId: integer("gmail_message_id")
      .notNull()
      .references(() => gmailMessages.id, { onDelete: "cascade" }),

    /**
     * The MIME `Content-ID` (without angle brackets) the HTML body references
     * as `src="cid:<contentId>"`. Used to rewrite the body to `delivery_url`.
     * NULL for images with no cid (rare — rendered by delivery_url directly).
     */
    contentId: text("content_id"),

    /** Cloudflare Images image id (for later delete/transform). */
    cfImageId: text("cf_image_id"),

    /** Served delivery URL (imagedelivery.net/.../public). */
    deliveryUrl: text("delivery_url").notNull(),

    /** Original part MIME type, e.g. "image/png". */
    mimeType: text("mime_type"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    messageIdx: index("gmail_message_images_message_id_idx").on(table.gmailMessageId),
  }),
);

export type GmailMessageImage = typeof gmailMessageImages.$inferSelect;
export type GmailMessageImageInsert = typeof gmailMessageImages.$inferInsert;
