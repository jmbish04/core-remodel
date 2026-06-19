import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Normalized categories/types of construction activities.
 * E.g., "Drywall", "Plumbing/Bath", "Flooring", "General", "Electrical", etc.
 * Feeds the lookup list that all budget items and standard costs reference.
 */
export const workItemTypes = sqliteTable("work_item_types", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),       // slug: "drywall", "plumbing_bath", etc.
  name: text("name").notNull(),              // display: "Drywall", "Plumbing/Bath", etc.
  description: text("description"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type WorkItemType = typeof workItemTypes.$inferSelect;
export type WorkItemTypeInsert = typeof workItemTypes.$inferInsert;
