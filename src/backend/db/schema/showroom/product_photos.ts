// src/backend/db/schema/showroom/product_photos.ts
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { showroomStoreProducts } from "./store_products";
import { showroomStores } from "./stores";
import { productPhotoBuckets } from "./product_photo_buckets";

/**
 * Product Showroom Photos — the D1 half of a Vectorize pairing. Each row is a
 * photo captured of a product (or its price card) at a showroom (or online).
 * `ragUuid` is written onto BOTH this row AND the Vectorize vector metadata in
 * PHOTO_INDEX, so a visual-quality / similar-products query hits Vectorize, gets
 * back ragUuids, and joins here for the AI-returned `attributes` + `status`.
 * Mirrors the existing browser_run_pages.ragUuid convention.
 */
export const productShowroomPhotos = sqliteTable(
  "product_showroom_photos",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Join key shared with the Vectorize vector's metadata. 1 photo = 1 vector. */
    ragUuid: text("rag_uuid").notNull(),

    productId: integer("product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    /** Nullable — a photo may come from an online source, not a showroom. */
    showroomId: integer("showroom_id").references(() => showroomStores.id, {
      onDelete: "set null",
    }),

    /** C2 intake wizard grouping — nullable until the photo is merged into a bucket. */
    bucketId: integer("bucket_id").references(() => productPhotoBuckets.id, {
      onDelete: "set null",
    }),

    /** Original uploaded filename, kept for the filename-ASC ordering step. */
    fileName: text("file_name"),
    /** Manual reorder override within a bucket; defaults to filename-ASC. */
    sortOrder: integer("sort_order").notNull().default(0),

    /** Stored asset path: CF Images delivery URL (current pipeline) or R2 URL. */
    imageUrl: text("image_url"),
    cfImageId: text("cf_image_id"),

    /** Primary material category depicted (aligned to browse-by categories in B). */
    category: text("category"),

    photoKind: text("photo_kind", {
      enum: ["product", "price_card", "spec_sheet", "unknown"] as const,
    })
      .notNull()
      .default("unknown"),

    /** AI structured-response payload: {metal, finish, dominantColors, brand,
     * modelNumber, style, price, salePrice, discountInfo, ...} + per-field confidence. */
    attributes: text("attributes", { mode: "json" }),

    status: text("status", {
      enum: ["pending_review", "approved", "rejected"] as const,
    })
      .notNull()
      .default("pending_review"),
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
    ragUuidUniq: uniqueIndex("product_showroom_photos_rag_uuid_uniq").on(
      table.ragUuid
    ),
    productIdx: index("product_showroom_photos_product_idx").on(table.productId),
    showroomIdx: index("product_showroom_photos_showroom_idx").on(
      table.showroomId
    ),
    bucketIdx: index("product_showroom_photos_bucket_idx").on(table.bucketId),
  })
);

export type ProductShowroomPhoto = typeof productShowroomPhotos.$inferSelect;
export type ProductShowroomPhotoInsert =
  typeof productShowroomPhotos.$inferInsert;
