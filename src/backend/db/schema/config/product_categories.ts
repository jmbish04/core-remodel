// src/backend/db/schema/config/product_categories.ts
import { sql } from "drizzle-orm";
import { sqliteTable, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

import { categories } from "./categories";
import { showroomStoreProducts } from "../showroom/store_products";

/**
 * Product <-> Category mapping — many-to-many join between
 * `showroom_store_products` and the shared `categories` vocabulary
 * (AGENTS.md "Multi-select & config-driven definitions"). One row per
 * (product, category) pair; the unique index enforces no duplicate mappings.
 */
export const productCategories = sqliteTable(
  "product_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    productId: integer("product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    productCategoryUniq: uniqueIndex(
      "product_categories_product_category_uniq"
    ).on(table.productId, table.categoryId),
  })
);

export type ProductCategory = typeof productCategories.$inferSelect;
export type ProductCategoryInsert = typeof productCategories.$inferInsert;
