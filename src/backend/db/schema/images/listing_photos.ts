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
  skipBlankCanvas: integer("skip_blank_canvas", { mode: "boolean" })
    .notNull()
    .default(false),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const listingPhotoBlankCanvases = sqliteTable("listing_photo_blank_canvases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  listingPhotoId: integer("listing_photo_id")
    .notNull()
    .references(() => listingPhotos.id, { onDelete: "cascade" }),
  cfImageId: text("cf_image_id").notNull(),
  prompt: text("prompt"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
