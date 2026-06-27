import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { showroomStoreProducts } from "./store_products";

/**
 * Product Images — semantic product imagery discovered during sourcing sweeps.
 *
 * These rows intentionally sit beside `store_product_docs`: docs stores
 * user-uploaded/attached artifacts, while this table stores source-cited
 * Cloudflare Images deliveries scraped by the research agent.
 */
export const productImages = sqliteTable(
  "product_images",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    storeProductId: integer("store_product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    /** Original image URL from the cited page before Cloudflare Images upload. */
    sourceUrl: text("source_url").notNull(),
    /** Page URL where this image was discovered. */
    sourcePageUrl: text("source_page_url"),
    /** Cloudflare Images asset ID. */
    cfImageId: text("cf_image_id"),
    /** Public Cloudflare Images delivery URL. */
    deliveryUrl: text("delivery_url").notNull(),

    altText: text("alt_text"),
    imageKind: text("image_kind", {
      enum: ["product", "lifestyle", "spec", "packaging", "unknown"],
    })
      .notNull()
      .default("unknown"),
    width: integer("width"),
    height: integer("height"),
    mimeType: text("mime_type"),
    ogTitle: text("og_title"),
    ogDescription: text("og_description"),
    metadataJson: text("metadata_json"),

    /**
     * Human-in-the-loop review state. Scraping can surface spam/irrelevant
     * imagery, so the homeowner approves real assets and rejects junk before it
     * is shown as the product's media.
     */
    reviewStatus: text("review_status", {
      enum: ["pending", "approved", "rejected"],
    })
      .notNull()
      .default("pending"),
    reviewReason: text("review_reason"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    sourceUnique: uniqueIndex("product_images_product_source_unique").on(
      table.storeProductId,
      table.sourceUrl,
    ),
    productIdx: index("product_images_store_product_idx").on(table.storeProductId),
  }),
);

export type ProductImage = typeof productImages.$inferSelect;
export type ProductImageInsert = typeof productImages.$inferInsert;
