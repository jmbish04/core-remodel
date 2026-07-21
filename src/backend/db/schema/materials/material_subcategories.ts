// src/backend/db/schema/materials/material_subcategories.ts
import { sql } from "drizzle-orm";
import { sqliteTable, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

import { subcategories } from "../config/subcategories";
import { materialScheduleItems } from "./schedule_item";

/**
 * Material <-> Subcategory mapping — many-to-many join between
 * `material_schedule_items` and the shared `subcategories` vocabulary
 * (AGENTS.md "Multi-select & config-driven definitions"). Kept SEPARATE from
 * `material_categories` — a material can carry a bare category with no
 * subcategory. One row per (material, subcategory) pair; the unique index
 * enforces no duplicate mappings.
 */
export const materialSubcategories = sqliteTable(
  "material_subcategories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    materialId: integer("material_id")
      .notNull()
      .references(() => materialScheduleItems.id, { onDelete: "cascade" }),

    subcategoryId: integer("subcategory_id")
      .notNull()
      .references(() => subcategories.id, { onDelete: "cascade" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    materialSubcategoryUniq: uniqueIndex(
      "material_subcategories_material_subcategory_uniq"
    ).on(table.materialId, table.subcategoryId),
  })
);

export type MaterialSubcategory = typeof materialSubcategories.$inferSelect;
export type MaterialSubcategoryInsert = typeof materialSubcategories.$inferInsert;
