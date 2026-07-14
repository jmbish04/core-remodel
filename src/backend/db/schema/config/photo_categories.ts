// src/backend/db/schema/config/photo_categories.ts
import { sql } from "drizzle-orm";
import { sqliteTable, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

import { categories } from "./categories";
import { productShowroomPhotos } from "../showroom/product_photos";

/**
 * Photo <-> Category mapping — many-to-many join between
 * `product_showroom_photos` and the shared `categories` vocabulary
 * (AGENTS.md "Multi-select & config-driven definitions"). One row per
 * (photo, category) pair; the unique index enforces no duplicate mappings.
 */
export const photoCategories = sqliteTable(
  "photo_categories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    photoId: integer("photo_id")
      .notNull()
      .references(() => productShowroomPhotos.id, { onDelete: "cascade" }),

    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    photoCategoryUniq: uniqueIndex("photo_categories_photo_category_uniq").on(
      table.photoId,
      table.categoryId
    ),
  })
);

export type PhotoCategory = typeof photoCategories.$inferSelect;
export type PhotoCategoryInsert = typeof photoCategories.$inferInsert;
