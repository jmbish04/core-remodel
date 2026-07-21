// src/backend/db/schema/materials/material_categories.ts
import { sql } from "drizzle-orm";
import { sqliteTable, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

import { categories } from "../config/categories";
import { materialScheduleItems } from "./schedule_item";

/**
 * Material <-> Category mapping — many-to-many join between
 * `material_schedule_items` and the shared `categories` vocabulary
 * (AGENTS.md "Multi-select & config-driven definitions"). One row per
 * (material, category) pair; the unique index enforces no duplicate mappings.
 */
export const materialCategories = sqliteTable(
  "material_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    materialId: integer("material_id")
      .notNull()
      .references(() => materialScheduleItems.id, { onDelete: "cascade" }),

    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    materialCategoryUniq: uniqueIndex(
      "material_categories_material_category_uniq"
    ).on(table.materialId, table.categoryId),
  })
);

export type MaterialCategory = typeof materialCategories.$inferSelect;
export type MaterialCategoryInsert = typeof materialCategories.$inferInsert;
