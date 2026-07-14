// src/backend/db/schema/config/photo_subcategories.ts
import { sql } from "drizzle-orm";
import { sqliteTable, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

import { subcategories } from "./subcategories";
import { productShowroomPhotos } from "../showroom/product_photos";

/**
 * Photo <-> Subcategory mapping — many-to-many join between
 * `product_showroom_photos` and the shared `subcategories` vocabulary
 * (AGENTS.md "Multi-select & config-driven definitions"). One row per
 * (photo, subcategory) pair; the unique index enforces no duplicate mappings.
 */
export const photoSubcategories = sqliteTable(
  "photo_subcategories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    photoId: integer("photo_id")
      .notNull()
      .references(() => productShowroomPhotos.id, { onDelete: "cascade" }),

    subcategoryId: integer("subcategory_id")
      .notNull()
      .references(() => subcategories.id, { onDelete: "cascade" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    photoSubcategoryUniq: uniqueIndex(
      "photo_subcategories_photo_subcategory_uniq"
    ).on(table.photoId, table.subcategoryId),
  })
);

export type PhotoSubcategory = typeof photoSubcategories.$inferSelect;
export type PhotoSubcategoryInsert = typeof photoSubcategories.$inferInsert;
