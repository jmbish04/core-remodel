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

  /**
   * Human-in-the-loop review state. Workers AI parses findings and binds them
   * to a fixed target, so a fact can be mis-attributed; the homeowner approves
   * correct facts and rejects wrong/junk ones. Rejections (with a reason) feed
   * the sweep's negative constraints so the system learns from corrections.
   */
  reviewStatus: text("review_status", {
    enum: ["pending", "approved", "rejected"],
  })
    .notNull()
    .default("pending"),
  reviewReason: text("review_reason"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
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

  /** HITL review state — see store_product_research.review_status. */
  reviewStatus: text("review_status", {
    enum: ["pending", "approved", "rejected"],
  })
    .notNull()
    .default("pending"),
  reviewReason: text("review_reason"),
  reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
});

export type StoreProductResearchType = typeof storeProductResearch.$inferSelect;
export type StoreProductResearchInsert =
  typeof storeProductResearch.$inferInsert;
export type StoreResearchType = typeof storeResearch.$inferSelect;
export type StoreResearchInsert = typeof storeResearch.$inferInsert;
