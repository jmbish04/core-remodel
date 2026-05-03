import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Images table for remodel mood board system
 */
export const images = sqliteTable("images", {
  id: text("id").primaryKey(), // UUID
  cfImageIdOriginal: text("cf_image_id_original").notNull(),
  cfImageIdOptimized: text("cf_image_id_optimized"),
  roomType: text("room_type"), // e.g., "kitchen", "bathroom", "living room"
  isInstagram: integer("is_instagram", { mode: "boolean" }).notNull().default(false),
  instagramAccount: text("instagram_account"),
  instagramCaption: text("instagram_caption"),
  metadata: text("metadata"), // JSON for keywords/structured AI response
  isListingPhoto: integer("is_listing_photo", { mode: "boolean" }).notNull().default(false),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
