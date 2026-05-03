import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Mood boards table
 */
export const moodBoards = sqliteTable("mood_boards", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  backgroundColor: text("background_color").default("#ffffff"),
  layoutState: text("layout_state"), // JSON for positions/styles
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeLastModified: integer("datetime_last_modified", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
