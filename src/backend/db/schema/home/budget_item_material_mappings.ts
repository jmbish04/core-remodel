import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { materialScheduleItems } from "../materials/schedule_item";

/**
 * Budget item ↔ Material mapping (0015 migration C).
 *
 * Pairs a material schedule item with the budget line it rolls up to, so the
 * budget report can attribute actual material spend to a budget category and
 * flag below/at/over.
 *
 * IMPORTANT: budget items revision in place — `budget_tracker_items` inserts a
 * NEW row (new `id`, same `trackId`) on every edit and marks the old row
 * inactive. So this join references the stable **`budgetItemTrackId`** (text),
 * NOT the row `id`, which would dangle on the next edit. It is therefore a
 * plain text column (no FK — `trackId` is not a unique key).
 */
export const budgetItemMaterialMappings = sqliteTable(
  "budget_item_material_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    budgetItemTrackId: text("budget_item_track_id").notNull(),
    materialId: integer("material_id")
      .notNull()
      .references(() => materialScheduleItems.id, { onDelete: "cascade" }),
    // Seconds since epoch — repo-wide convention (never milliseconds).
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    uniqueBudgetMaterial: uniqueIndex("ux_budget_item_material").on(
      table.budgetItemTrackId,
      table.materialId,
    ),
  }),
);

export type BudgetItemMaterialMapping = typeof budgetItemMaterialMappings.$inferSelect;
export type BudgetItemMaterialMappingInsert = typeof budgetItemMaterialMappings.$inferInsert;
