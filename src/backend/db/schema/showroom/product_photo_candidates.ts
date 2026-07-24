// src/backend/db/schema/showroom/product_photo_candidates.ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { productPhotoBuckets } from "./product_photo_buckets";
import { showroomStoreProducts } from "./store_products";
import { brands } from "../brands/brands";

/**
 * Bucket Product Candidates (Phase C) — the durable output of the intake
 * Workflow. Processing a bucket no longer creates exactly one product inline;
 * it yields 0-N *candidate* matches the human reviews later (HITL, Phase D/E).
 *
 * A candidate holds the AI-extracted + scraped product identity plus the
 * source URLs of imagery/PDFs discovered on the web — the images are NOT
 * downloaded here; only their `*_source_urls` are staged. The real
 * `brands` / `showroom_store_products` rows are created ONLY when a human
 * confirms a candidate (that sets `confirmed_product_id`).
 *
 * Retention rule (per product direction): EVERY candidate and its reaction is
 * kept, including ones the reviewer rejects/dislikes — that's the style-training
 * signal. `status = "rejected"` marks them; nothing is deleted.
 */
export const bucketProductCandidates = sqliteTable(
  "bucket_product_candidates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    bucketId: integer("bucket_id")
      .notNull()
      .references(() => productPhotoBuckets.id, { onDelete: "cascade" }),

    /** 0 = best match. Ordering for the HITL walkthrough. */
    rank: integer("rank").notNull().default(0),
    /** AI confidence 0-100 that this candidate is the depicted product. */
    confidence: integer("confidence"),

    // ── Extracted / scraped identity ─────────────────────────────────────────
    /** Matched existing brand, when the extraction resolved to one. */
    brandId: integer("brand_id").references(() => brands.id, {
      onDelete: "set null",
    }),
    /** Brand name as extracted/printed (kept even when brandId matched). */
    brandNameRaw: text("brand_name_raw"),
    productName: text("product_name"),
    modelNumber: text("model_number"),
    sku: text("sku"),
    /** Product-listing URL this candidate was scraped from / points at. */
    productUrl: text("product_url"),
    category: text("category"),
    style: text("style"),

    // Prices captured verbatim (mirrors PRODUCT_EXTRACTION_SCHEMA strings).
    priceText: text("price_text"),
    salePriceText: text("sale_price_text"),
    discountText: text("discount_text"),

    /** JSON string[] of image source URLs (NOT downloaded — staged for HITL confirm). */
    imageSourceUrls: text("image_source_urls"),
    /** JSON string[] of PDF/spec-sheet source URLs (NOT downloaded). */
    pdfSourceUrls: text("pdf_source_urls"),
    /** JSON [{ name, hexCode }] colors/finishes. */
    colors: text("colors"),

    /** AI rationale — why this candidate matches the bucket photos. */
    rationale: text("rationale"),
    /** JSON blob of the full raw extraction, for debugging/re-processing. */
    rawExtraction: text("raw_extraction"),

    // ── Reaction layer (Phase D/E fills these; all nullable) ─────────────────
    /** Human confirms this candidate IS the product depicted. */
    isMatch: integer("is_match", { mode: "boolean" }),
    /** Human likes it (taste signal, independent of match). */
    liked: integer("liked", { mode: "boolean" }),
    /** 1-5 star rating. */
    stars: integer("stars"),
    /** Whisper transcript of the voice reaction. */
    reactionTranscript: text("reaction_transcript"),
    /** AI style-summary distilled from the reaction. */
    reactionSummary: text("reaction_summary"),

    // ── Lifecycle ────────────────────────────────────────────────────────────
    // TS-only union (sqlite text has no CHECK) — safe to extend in place.
    status: text("status", {
      enum: ["pending", "confirmed", "rejected"] as const,
    })
      .notNull()
      .default("pending"),

    /** Set on HITL confirm — the real product this candidate became. */
    confirmedProductId: integer("confirmed_product_id").references(
      () => showroomStoreProducts.id,
      { onDelete: "set null" }
    ),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    bucketIdx: index("bucket_product_candidates_bucket_idx").on(table.bucketId),
  })
);

export type BucketProductCandidate = typeof bucketProductCandidates.$inferSelect;
export type BucketProductCandidateInsert =
  typeof bucketProductCandidates.$inferInsert;
