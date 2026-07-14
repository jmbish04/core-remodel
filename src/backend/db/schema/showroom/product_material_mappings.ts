import { sql } from "drizzle-orm";
import { integer, sqliteTable, uniqueIndex } from "drizzle-orm/sqlite-core";

import { materialScheduleItems } from "../materials/schedule_item";
import { showroomStoreProducts } from "./store_products";

/**
 * Product ↔ Material mapping (0015 migration A).
 *
 * `showroom_store_products.materialId` already carries a single "primary"
 * material pointer, but a single purchased product model can satisfy MORE than
 * one material item (e.g. one Kohler toilet model bought for both the hall bath
 * and the lower bath). This join makes that many-to-many explicit while the
 * legacy `materialId` column stays as the denormalized primary link.
 *
 * `isPrimary` flags the product's principal material (mirrors the legacy
 * column) so reports can pick one canonical row without extra joins.
 */
export const productMaterialMappings = sqliteTable(
  "product_material_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),
    materialId: integer("material_id")
      .notNull()
      .references(() => materialScheduleItems.id, { onDelete: "cascade" }),
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
    // Seconds since epoch — repo-wide convention (never milliseconds).
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    uniqueProductMaterial: uniqueIndex("ux_product_material").on(table.productId, table.materialId),
  }),
);

export type ProductMaterialMapping = typeof productMaterialMappings.$inferSelect;
export type ProductMaterialMappingInsert = typeof productMaterialMappings.$inferInsert;
