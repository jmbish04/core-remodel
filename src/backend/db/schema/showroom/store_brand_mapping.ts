import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";
import { showroomBrands } from "./brands";

/**
 * Store → Brand mapping — many-to-many join between showroom locations
 * and the brands they carry.
 *
 * Populated by the ShowroomResearchAgent when scraping a showroom's website.
 * The agent first ensures the brand exists in `showroom_brands` (dedup by
 * slug), then creates this mapping if not already present.
 */
export const storeBrandMapping = sqliteTable(
  "store_brand_mapping",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    storeId: integer("store_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    brandId: integer("brand_id")
      .notNull()
      .references(() => showroomBrands.id, { onDelete: "cascade" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    storeBrandUnique: uniqueIndex("store_brand_mapping_unique").on(
      table.storeId,
      table.brandId,
    ),
  }),
);

export type StoreBrandMapping = typeof storeBrandMapping.$inferSelect;
export type StoreBrandMappingInsert = typeof storeBrandMapping.$inferInsert;
