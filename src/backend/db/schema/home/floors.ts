import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Canonical home floor definitions.
 * Example keys: lower_level, upper_level.
 */
export const floors = sqliteTable("floors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  levelOrder: integer("level_order").notNull().default(0),
  livingSqFt: integer("living_sq_ft"),
  notes: text("notes"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
