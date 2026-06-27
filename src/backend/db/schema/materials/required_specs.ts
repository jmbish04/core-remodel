import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { materialScheduleItems } from "./schedule_item";

/**
 * Material Required Specs — key/value pairs describing what specs a material
 * must meet (used for matching against showroom product specs).
 *
 * Examples:
 *   key: "Burner Zones"   → value: "3"
 *   key: "Min Width"      → value: "30 inches"
 *   key: "Fuel Type"      → value: "Induction"
 */
export const materialRequiredSpecs = sqliteTable("material_required_specs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  materialId: integer("material_id")
    .notNull()
    .references(() => materialScheduleItems.id, { onDelete: "cascade" }),

  /** When this spec was added. */
  dateAdded: integer("date_added", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),

  /** Spec key — e.g. "Burner Zones", "Min Width", "Fuel Type". */
  key: text("key").notNull(),

  /** Spec value — e.g. "3", "30 inches", "Induction". */
  value: text("value").notNull(),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type MaterialRequiredSpec = typeof materialRequiredSpecs.$inferSelect;
export type MaterialRequiredSpecInsert =
  typeof materialRequiredSpecs.$inferInsert;
