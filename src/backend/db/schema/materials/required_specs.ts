import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { materialScheduleItems } from "./schedule_item";

/**
 * Material Required Specs — the exact spec requirements for a material
 * (e.g. "Burner Zones" = "4"). Used to match required specs against the
 * specs of sourced showroom products.
 */
export const materialRequiredSpecs = sqliteTable("material_required_specs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  materialId: integer("material_id")
    .notNull()
    .references(() => materialScheduleItems.id, { onDelete: "cascade" }),

  dateAdded: integer("date_added", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),

  key: text("key").notNull(),
  value: text("value").notNull(),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type MaterialRequiredSpec = typeof materialRequiredSpecs.$inferSelect;
export type MaterialRequiredSpecInsert = typeof materialRequiredSpecs.$inferInsert;
