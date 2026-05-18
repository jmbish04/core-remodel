import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Top-level project phases/epics used to group planning tasks.
 */
export const planningEpics = sqliteTable("planning_epics", {
  id: text("id").primaryKey(), // UUID
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  phaseOrder: integer("phase_order").notNull().default(0),
  metadata: text("metadata"), // JSON
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
