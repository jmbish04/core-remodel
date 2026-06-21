import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";
import { showroomStoreProducts } from "./store_products";

/**
 * Store Notes — freeform notes on a store location.
 *
 * Supports revision tracking via is_active (soft delete when replaced).
 */
export const storeNotes = sqliteTable("store_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storeId: integer("store_id")
    .notNull()
    .references(() => showroomStores.id, { onDelete: "cascade" }),

  timestamp: integer("timestamp", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),

  note: text("note").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
});

/**
 * Store Product Notes — freeform notes on a specific product.
 */
export const storeProductNotes = sqliteTable("store_product_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storeProductId: integer("store_product_id")
    .notNull()
    .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

  timestamp: integer("timestamp", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),

  note: text("note").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
});

export type StoreNote = typeof storeNotes.$inferSelect;
export type StoreNoteInsert = typeof storeNotes.$inferInsert;
export type StoreProductNote = typeof storeProductNotes.$inferSelect;
export type StoreProductNoteInsert = typeof storeProductNotes.$inferInsert;
