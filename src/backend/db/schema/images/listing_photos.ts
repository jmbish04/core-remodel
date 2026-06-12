import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";
import { images } from "./images";

/**
 * Listing photos table - separate tracking for house stock photos
 */
export const listingPhotos = sqliteTable("listing_photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  imageId: text("image_id").references(() => images.id, { onDelete: "set null" }),
  cfImageId: text("cf_image_id").notNull(),
  blankCanvasCfImageId: text("blank_canvas_cf_image_id"),
  roomId: integer("room_id").references(() => rooms.id, {
    onDelete: "restrict",
  }),
  roomName: text("room_name").notNull(),
  description: text("description"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
