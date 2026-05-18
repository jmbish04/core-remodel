import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { images } from "./images";

/**
 * Session-level container for iterative photo editing threads.
 */
export const imageEditSessions = sqliteTable("image_edit_sessions", {
  id: text("id").primaryKey(), // UUID
  name: text("name").notNull(),
  sourceImageId: text("source_image_id").references(() => images.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("active"), // active | archived
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeLastModified: integer("datetime_last_modified", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
