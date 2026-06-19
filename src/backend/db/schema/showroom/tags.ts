import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";
import { showroomStoreProducts } from "./store_products";

/**
 * Tag Definitions — user-defined taxonomy for organizing stores and products.
 *
 * Supports hierarchical tags via parent_id (self-referencing FK).
 * Tags can be scoped to stores-only or products-only.
 */
export const showroomTagDef = sqliteTable("showroom_tag_def", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color"),

  /** Self-referencing FK for hierarchical tag nesting. */
  parentId: integer("parent_id"),

  isActive: integer("is_active", { mode: "boolean" }).default(true),
  isStoreTagOnly: integer("is_store_tag_only", { mode: "boolean" }).default(
    false
  ),
  isStoreProductTagOnly: integer("is_store_product_tag_only", {
    mode: "boolean",
  }).default(false),
});

/**
 * Store → Tag mapping.
 */
export const storeTagMapping = sqliteTable("store_tag_mapping", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: integer("timestamp", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),
  showroomTagId: integer("showroom_tag_id")
    .notNull()
    .references(() => showroomTagDef.id, { onDelete: "cascade" }),
  storeId: integer("store_id")
    .notNull()
    .references(() => showroomStores.id, { onDelete: "cascade" }),
});

/**
 * Store Product → Tag mapping.
 */
export const storeProductTagMapping = sqliteTable(
  "store_product_tag_mapping",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    timestamp: integer("timestamp", { mode: "timestamp" }).default(
      sql`(unixepoch())`
    ),
    showroomTagId: integer("showroom_tag_id")
      .notNull()
      .references(() => showroomTagDef.id, { onDelete: "cascade" }),
    storeProductId: integer("store_product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),
  }
);

export type ShowroomTagDefType = typeof showroomTagDef.$inferSelect;
export type ShowroomTagDefInsert = typeof showroomTagDef.$inferInsert;
