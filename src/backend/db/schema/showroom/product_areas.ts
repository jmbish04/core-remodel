import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";
import { showroomStoreProducts } from "./store_products";

/**
 * Product Area Definitions — categorizes what room + product type a store covers.
 *
 * room_name: kitchen, bathroom, outdoor, closet, living, general
 * name:      the specific product area within the room (e.g., faucet, vanity, tile)
 */
export const storeProductAreaDef = sqliteTable("store_product_area_def", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roomName: text("room_name").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
});

/**
 * Store → Product Area mapping.
 * Links a showroom to the product areas it covers.
 */
export const storePaMapping = sqliteTable("store_pa_mapping", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storeId: integer("store_id")
    .notNull()
    .references(() => showroomStores.id, { onDelete: "cascade" }),
  productAreaId: integer("product_area_id")
    .notNull()
    .references(() => storeProductAreaDef.id, { onDelete: "cascade" }),
});

/**
 * Store Product → Product Area mapping.
 * Links a specific product to its applicable product area(s).
 */
export const storeProductPaMapping = sqliteTable("store_product_pa_mapping", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storeProductId: integer("store_product_id")
    .notNull()
    .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),
  productAreaId: integer("product_area_id")
    .notNull()
    .references(() => storeProductAreaDef.id, { onDelete: "cascade" }),
});

export type StoreProductAreaDefType = typeof storeProductAreaDef.$inferSelect;
export type StoreProductAreaDefInsert = typeof storeProductAreaDef.$inferInsert;
