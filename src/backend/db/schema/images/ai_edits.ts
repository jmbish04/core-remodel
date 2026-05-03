import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { listingPhotos } from "./listing_photos";

/**
 * AI edits table for tracking AI-generated image modifications
 */
export const aiEdits = sqliteTable("ai_edits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  originalListingId: integer("original_listing_id")
    .notNull()
    .references(() => listingPhotos.id, { onDelete: "cascade" }),
  prompt: text("prompt").notNull(),
  generatedCfImageId: text("generated_cf_image_id").notNull(),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
