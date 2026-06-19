import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { showroomStoreProducts } from "./store_products";
import { showroomStores } from "./stores";

/**
 * Store Product Research — AI-gathered findings about specific products.
 *
 * Populated by the ShowroomResearchAgent when a product is added.
 * Each row is a single research finding (review, spec detail, warning, etc).
 */
export const storeProductResearch = sqliteTable("store_product_research", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storeProductId: integer("store_product_id")
    .notNull()
    .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

  timestamp: integer("timestamp", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),

  finding: text("finding").notNull(),
  findingUrl: text("finding_url"),

  sentiment: text("sentiment", {
    enum: ["good", "bad", "neutral"],
  }),
});

/**
 * Store Research — AI-gathered findings about a store / showroom location.
 *
 * Populated by the ShowroomResearchAgent when a store is added.
 * Covers reputation, reliability, return policies, delivery info, etc.
 */
export const storeResearch = sqliteTable("store_research", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storeId: integer("store_id")
    .notNull()
    .references(() => showroomStores.id, { onDelete: "cascade" }),

  timestamp: integer("timestamp", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),

  finding: text("finding").notNull(),
  findingUrl: text("finding_url"),

  sentiment: text("sentiment", {
    enum: ["good", "bad", "neutral"],
  }),
});

export type StoreProductResearchType = typeof storeProductResearch.$inferSelect;
export type StoreProductResearchInsert =
  typeof storeProductResearch.$inferInsert;
export type StoreResearchType = typeof storeResearch.$inferSelect;
export type StoreResearchInsert = typeof storeResearch.$inferInsert;
