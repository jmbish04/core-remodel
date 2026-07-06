import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Saved image searches - allows users to save and retrieve inspiration gallery searches.
 */
export const savedImageSearches = sqliteTable("saved_image_searches", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  queryText: text("query_text"),
  selectedTags: text("selected_tags"), // JSON array of tag strings
  selectedRoomIds: text("selected_room_ids"), // JSON array of room ID numbers
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
