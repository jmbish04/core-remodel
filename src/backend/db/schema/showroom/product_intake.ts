import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { showroomStoreProducts } from "./store_products";

/**
 * Product intake tables — the record of what a product scrape actually saw.
 *
 * The pipeline starts at `showroom_store_products.source_url` and fans out:
 * every page visited is logged here, every link found is indexed, every
 * downloadable file is archived to R2, and the AI's ratings/verdicts are kept
 * with the evidence that produced them.
 *
 * `rag_uuid` appears on the tables whose text gets embedded. It is the join key
 * between a D1 row and its Vectorize entry — the same value goes in the vector
 * metadata, so a semantic hit can be resolved back to the exact source row.
 * The auto-increment `id` is NOT usable for this: ids are per-table and would
 * collide across corpora in a shared index.
 */

/**
 * Every link extracted from a scraped page.
 *
 * Kept even when never followed — an unfollowed link is a candidate for the
 * next crawl pass, and the set of outbound links is itself signal about a
 * product (spec sheets, related models, dealer locators).
 */
export const showroomProductLinks = sqliteTable(
  "showroom_product_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    /** The page this link was found ON (not where it points). */
    scrapeUrl: text("scrape_url").notNull(),
    /** The href, absolutised against the page it came from. */
    extractedUrl: text("extracted_url").notNull(),
    /** Anchor text / aria-label, when the page gave one. */
    extractedUrlLabel: text("extracted_url_label"),

    /** True when the crawler inserted this row. */
    isScraped: integer("is_scraped", { mode: "boolean" }).notNull().default(true),
    /** True when a human added the URL after intake. */
    isManuallyAdded: integer("is_manually_added", { mode: "boolean" })
      .notNull()
      .default(false),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    // A page legitimately links the same target twice; dedupe on the triple so
    // re-running a scrape is idempotent rather than additive.
    linkUniq: uniqueIndex("showroom_product_links_uniq").on(
      table.productId,
      table.scrapeUrl,
      table.extractedUrl,
    ),
    productIdx: index("showroom_product_links_product_idx").on(table.productId),
  }),
);

/** Every page the scraper actually loaded, with its archived content. */
export const showroomProductScrapedPages = sqliteTable(
  "showroom_product_scraped_pages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Vectorize metadata key for this page's markdown embedding. */
    ragUuid: text("rag_uuid").notNull(),
    productId: integer("product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    scrapedUrl: text("scraped_url").notNull(),
    /** Raw HTML in R2 — the fallback when extraction needs redoing. */
    r2HtmlKey: text("r2_html_key"),
    markdownContent: text("markdown_content"),
    fullPageScreenshotCfImageUrl: text("full_page_screenshot_cf_image_url"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    ragUuidUniq: uniqueIndex("showroom_product_scraped_pages_rag_uuid_uniq").on(
      table.ragUuid,
    ),
    pageUniq: uniqueIndex("showroom_product_scraped_pages_uniq").on(
      table.productId,
      table.scrapedUrl,
    ),
  }),
);

/**
 * Downloadable files found during intake — spec sheets, CAD, warranties.
 *
 * The source file lands in R2 as-is; once parsed to markdown the RAG-ready text
 * is stored alongside it, so re-embedding never requires re-downloading.
 */
export const productDocuments = sqliteTable(
  "product_documents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Vectorize metadata key for this document's embedding. */
    ragUuid: text("rag_uuid").notNull(),
    productId: integer("product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),
    /** The page this file was linked from. */
    scrapeId: integer("scrape_id").references(
      () => showroomProductScrapedPages.id,
      { onDelete: "set null" },
    ),

    /** Download URL. */
    scrapeUrl: text("scrape_url").notNull(),
    /** The href's anchor text, which often names the document better than the file does. */
    websiteDocumentLinkLabel: text("website_document_link_label"),

    title: text("title"),
    /** AI-generated summary of what the document contains. */
    description: text("description"),

    productDocType: text("product_doc_type", {
      enum: [
        "INSTALL_INSTRUCTIONS",
        "SPEC_SHEET",
        "3D_MODEL",
        "2D_MODEL",
        "TECH_DRAWING_MM",
        "TECH_DRAWING_INCHES",
        "WARRANTY",
        "OTHER",
      ],
    })
      .notNull()
      .default("OTHER"),

    fileType: text("file_type"),
    mimeType: text("mime_type"),

    sourceFileR2Key: text("source_file_r2_key"),
    sourceFileR2Url: text("source_file_r2_url"),
    /** Parsed markdown, once the file has been through extraction. */
    extractedContentR2Key: text("extracted_content_r2_key"),
    extractedContentR2Url: text("extracted_content_r2_url"),

    metadata: text("metadata"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    visibility: text("visibility", { enum: ["PRIVATE", "PUBLIC"] })
      .notNull()
      .default("PRIVATE"),
    extractionStatus: text("extraction_status", {
      enum: ["pending", "running", "complete", "failed", "unsupported"],
    })
      .notNull()
      .default("pending"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    ragUuidUniq: uniqueIndex("product_documents_rag_uuid_uniq").on(table.ragUuid),
    docUniq: uniqueIndex("product_documents_uniq").on(table.productId, table.scrapeUrl),
    productIdx: index("product_documents_product_idx").on(table.productId),
  }),
);

/** Individual customer reviews gathered during research. */
export const productRatings = sqliteTable(
  "product_ratings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    /** 1-5. Sources using other scales are normalised on the way in. */
    starsScore: integer("stars_score"),
    source: text("source", {
      enum: [
        "REDDIT",
        "YELP",
        "CONSUMER_REPORTS",
        "GOOGLE",
        "HOUZZ",
        "AMAZON",
        "HOME_DEPOT",
        "LOWES",
        "BUILD_COM",
        "FERGUSON",
        "WAYFAIR",
        "TRUSTPILOT",
        "MANUFACTURER_SITE",
        "YOUTUBE",
        "BLOG",
        "OTHER",
      ],
    })
      .notNull()
      .default("OTHER"),
    sourceUrl: text("source_url"),
    raterName: text("rater_name"),
    ratingText: text("rating_text"),
    /** What this review means in context — themes, credibility, caveats. */
    aiAnalysis: text("ai_analysis"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    productIdx: index("product_ratings_product_idx").on(table.productId),
  }),
);

/**
 * The AI's synthesised verdict on a product.
 *
 * Append-only: each research run adds a row rather than overwriting, so a
 * rating can be traced to the evidence available at the time and re-runs can be
 * compared. Read the newest row per product.
 */
export const productAiRating = sqliteTable(
  "product_ai_rating",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    timestamp: integer("timestamp", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    productId: integer("product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    /** Overall 1-5. */
    rating: integer("rating"),
    aiRationale: text("ai_rationale"),

    /**
     * Per-criterion scores driving the frontend scorecard, as JSON:
     *   [{ "key": "customer_reviews", "label": "Customer reviews",
     *      "score": 4, "rationale": "..." }, ...]
     * Stored as JSON rather than columns because the criteria set is expected
     * to change per product category.
     */
    aiRatingScorecardJson: text("ai_rating_scorecard_json"),
  },
  (table) => ({
    productIdx: index("product_ai_rating_product_idx").on(table.productId),
  }),
);

export type ShowroomProductLink = typeof showroomProductLinks.$inferSelect;
export type ShowroomProductLinkInsert = typeof showroomProductLinks.$inferInsert;
export type ShowroomProductScrapedPage = typeof showroomProductScrapedPages.$inferSelect;
export type ShowroomProductScrapedPageInsert =
  typeof showroomProductScrapedPages.$inferInsert;
export type ProductDocument = typeof productDocuments.$inferSelect;
export type ProductDocumentInsert = typeof productDocuments.$inferInsert;
export type ProductRating = typeof productRatings.$inferSelect;
export type ProductRatingInsert = typeof productRatings.$inferInsert;
export type ProductAiRating = typeof productAiRating.$inferSelect;
export type ProductAiRatingInsert = typeof productAiRating.$inferInsert;
