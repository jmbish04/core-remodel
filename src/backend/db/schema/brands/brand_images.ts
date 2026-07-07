import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

import { brands } from "./brands";

/**
 * Brand images — photos of the brand gathered by the BrandResearchWorkflow's
 * website scrape (product-line hero shots, lifestyle imagery, logo lockups).
 * Mirrors `showroom_images` conventions: original source URL + CF Images
 * delivery URL + HITL review status so junk scrapes never hit the viewport
 * unreviewed.
 */
export const brandImages = sqliteTable(
  "brand_images",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Owner brand. */
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),

    /** Original image URL before the CF Images upload. */
    sourceUrl: text("source_url").notNull(),

    /** Page the image was discovered on. */
    sourcePageUrl: text("source_page_url"),

    /** Cloudflare Images asset id. */
    cfImageId: text("cf_image_id"),

    /** Public CF Images delivery URL. */
    deliveryUrl: text("delivery_url").notNull(),

    /** Alt text for accessibility. */
    altText: text("alt_text"),

    /** Coarse image classification. */
    imageKind: text("image_kind", {
      enum: ["logo", "product", "lifestyle", "catalog", "unknown"],
    })
      .notNull()
      .default("unknown"),

    width: integer("width"),
    height: integer("height"),
    mimeType: text("mime_type"),

    /** Arbitrary extraction metadata. */
    metadataJson: text("metadata_json"),

    /** HITL review: pending | approved | rejected. */
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
    brandSourceUnique: uniqueIndex("brand_images_brand_source_unique").on(
      table.brandId,
      table.sourceUrl,
    ),
    brandIdx: index("brand_images_brand_idx").on(table.brandId),
  }),
);

export type BrandImage = typeof brandImages.$inferSelect;
export type BrandImageInsert = typeof brandImages.$inferInsert;
