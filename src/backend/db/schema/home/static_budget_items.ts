import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { floors } from "./floors";

/**
 * Curated budget items with min/avg/max cost ranges and comparison groups.
 * Merges primary static budget items, kitchen additions, and infrastructure.
 */
export const staticBudgetItems = sqliteTable(
  "static_budget_items",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    floorId: integer("floor_id")
      .references(() => floors.id, { onDelete: "cascade" }),
    floorName: text("floor_name"),
    areaRoom: text("area_room"),
    comparisonGroup: text("comparison_group"),
    itemDescription: text("item_description").notNull(),
    estimatedQty: real("estimated_qty"),
    unit: text("unit"),
    minUnitCost: real("min_unit_cost"),
    maxUnitCost: real("max_unit_cost"),
    minCost: real("min_cost"),
    avgCost: real("avg_cost"),
    maxCost: real("max_cost"),
    phaseTag: text("phase_tag"),
    notes: text("notes"),
    sourceSheet: text("source_sheet"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byCategory: index("idx_sbi_category").on(t.category),
    byFloor: index("idx_sbi_floor").on(t.floorId),
    byPhaseTag: index("idx_sbi_phase_tag").on(t.phaseTag),
  }),
);

export type StaticBudgetItem = typeof staticBudgetItems.$inferSelect;
export type StaticBudgetItemInsert = typeof staticBudgetItems.$inferInsert;
