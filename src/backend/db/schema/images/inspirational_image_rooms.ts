import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";
import { images } from "./images";

/**
 * Many-to-many mapping for inspirational photos to one or more rooms.
 * Listing photos still use images.roomId as a single required room assignment.
 */
export const inspirationalImageRooms = sqliteTable(
  "inspirational_image_rooms",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    imageRoomUnique: uniqueIndex("inspirational_image_rooms_image_room_unique").on(
      table.imageId,
      table.roomId,
    ),
  }),
);
