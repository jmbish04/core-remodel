// src/backend/db/schema/showroom/product_photo_buckets.ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";
import { showroomStoreProducts } from "./store_products";
import { brands } from "../brands/brands";

/**
 * Product Photo Buckets — the C2 intake-wizard grouping unit. A bucket is a
 * set of photos (usually adjacent filename-ASC burst shots) that all depict
 * ONE product; processing a bucket runs a single AI extraction over all its
 * photos together and produces one `showroom_store_products` row.
 *
 * Nullable `showroomId` covers online/manufacturer intake (no physical
 * showroom visit). Nullable `productId` is set once the bucket is processed.
 */
export const productPhotoBuckets = sqliteTable(
  "product_photo_buckets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    showroomId: integer("showroom_id").references(() => showroomStores.id, {
      onDelete: "cascade",
    }),

    productId: integer("product_id").references(
      () => showroomStoreProducts.id,
      { onDelete: "set null" }
    ),

    kind: text("kind", { enum: ["single", "multi"] as const })
      .notNull()
      .default("single"),

    // ponytail: widened for the C2 review form (Phase 3 approve/reject) without a
    // migration — sqlite `text` column carries no CHECK constraint, so this union
    // is TS-only and safe to extend in place. 'rejected' = the review form's
    // reject action.
    status: text("status", {
      enum: ["draft", "processing", "processed", "reviewed", "rejected"] as const,
    })
      .notNull()
      .default("draft"),

    /** Optional human note, e.g. "Kohler faucet display". */
    label: text("label"),

    // ── Per-stack hints (Phase A′) ───────────────────────────────────────────
    // Captured at GROUPING time so the intake workflow starts warm. All
    // optional. The workflow gate (Phase C) treats a bucket as ready when it
    // has a brand (id OR raw) OR a product URL — but nothing is blocked here.

    /** Matched existing brand, when the user picked one from autocomplete. */
    brandId: integer("brand_id").references(() => brands.id, {
      onDelete: "set null",
    }),
    /**
     * Free-typed brand the user entered via "other" when no existing brand
     * matched. Kept separate from `brandId` so the workflow knows it must scrape
     * this brand fresh rather than reuse a registered one.
     */
    brandNameRaw: text("brand_name_raw"),

    /** Product/model name as the user recalls it — may be misspelled; the
     *  workflow fuzzy-matches it against the brand sitemap. */
    productName: text("product_name"),
    modelNumber: text("model_number"),
    sku: text("sku"),
    /** Direct product-listing URL. When present, the workflow can skip
     *  brand deduction and scrape this page directly. */
    productUrl: text("product_url"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    showroomIdx: index("product_photo_buckets_showroom_idx").on(
      table.showroomId
    ),
  })
);

export type ProductPhotoBucket = typeof productPhotoBuckets.$inferSelect;
export type ProductPhotoBucketInsert = typeof productPhotoBuckets.$inferInsert;
