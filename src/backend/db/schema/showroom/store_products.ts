import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";

/**
 * Store Products — individual items sourced or tracked at a showroom location.
 */
export const showroomStoreProducts = sqliteTable("showroom_store_products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storeId: integer("store_id")
    .notNull()
    .references(() => showroomStores.id, { onDelete: "cascade" }),

  timestamp: integer("timestamp", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),

  itemName: text("item_name").notNull(),
  description: text("description"),
  colors: text("colors"),
  preferredColor: text("preferred_color"),
  sku: text("sku"),
  price: text("price"),

  /** Arbitrary structured data — dimensions, weight, model numbers, etc. */
  jsonDetails: text("json_details"),

  notes: text("notes"),
  leadTime: text("lead_time"),
  possibleDiscounts: text("possible_discounts"),
  tradeDiscount: text("trade_discount"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type ShowroomStoreProduct = typeof showroomStoreProducts.$inferSelect;
export type ShowroomStoreProductInsert =
  typeof showroomStoreProducts.$inferInsert;
