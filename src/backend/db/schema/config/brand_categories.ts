// src/backend/db/schema/config/brand_categories.ts
import { sql } from "drizzle-orm";
import { sqliteTable, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

import { categories } from "./categories";
import { brands } from "../brands/brands";

/**
 * Brand <-> Category mapping — many-to-many join between `brands` and the
 * shared `categories` vocabulary (AGENTS.md "Multi-select & config-driven
 * definitions"). One row per (brand, category) pair; the unique index
 * enforces no duplicate mappings.
 */
export const brandCategories = sqliteTable(
  "brand_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),

    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    brandCategoryUniq: uniqueIndex("brand_categories_brand_category_uniq").on(
      table.brandId,
      table.categoryId
    ),
  })
);

export type BrandCategory = typeof brandCategories.$inferSelect;
export type BrandCategoryInsert = typeof brandCategories.$inferInsert;
