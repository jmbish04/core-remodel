import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { showroomStoreProducts } from "./store_products";

/**
 * Product Docs — images and PDFs attached to store products.
 *
 * Images hosted on Cloudflare Images, PDFs/docs on R2.
 */
export const storeProductDocs = sqliteTable("store_product_docs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storeProductId: integer("store_product_id")
    .notNull()
    .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

  type: text("type", { enum: ["image", "pdf"] }).notNull(),

  /** R2 URL for PDFs/docs, Cloudflare Images URL for images. */
  url: text("url").notNull(),

  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),
});

export type StoreProductDoc = typeof storeProductDocs.$inferSelect;
export type StoreProductDocInsert = typeof storeProductDocs.$inferInsert;
