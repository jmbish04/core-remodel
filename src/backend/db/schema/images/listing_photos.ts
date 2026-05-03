import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Listing photos table - separate tracking for house stock photos
 */
export const listingPhotos = sqliteTable("listing_photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cfImageId: text("cf_image_id").notNull(),
  roomName: text("room_name").notNull(),
  description: text("description"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
