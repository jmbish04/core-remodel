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
    // ── Harvest metadata (0025 P2) ─────────────────────────────────────────────

  /** Byte size of the fetched image. Below threshold = spacer/tracking junk. */
  byteSize: integer("byte_size"),

  /**
   * SHA-256 of the image bytes. THE cross-run dedupe key: the same asset is
   * routinely served under several URLs, so a URL-only check re-stores it.
   * Indexed because every harvest seeds its dedupe set from this column.
   */
  contentHash: text("content_hash"),

  /**
   * False once the image is known-bad. Brand imagery is served from the BRAND'S
   * OWN server (no CF Images), so a URL can 404, hotlink-block or rot at any
   * time — and the failure surfaces in the browser, not on the worker. The
   * frontend reports it; every read path filters on this.
   */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  /** Why it was deactivated, e.g. "frontend detected error on image url". */
  inactiveReason: text("inactive_reason"),

  /**
   * Groups an image with its siblings so previews stay cohesive rather than a
   * shuffled wall. Derived from the filename stem — real gessi.com set:
   * `Collezione_Origini_warm_Gessi_HERO_<hash>.jpg` +
   * `Collezione_Origini_warm_Gessi_gallery_1..11_<hash>.jpg` all share the stem.
   * Computed ONCE on insert, never parsed on read.
   */
  imageGroupKey: text("image_group_key"),

  /** Order within the group: HERO = 0, gallery_N = N, unrecognised = 999. */
  groupSortOrder: integer("group_sort_order"),

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
    /**
     * Cross-run dedupe: every harvest seeds its "already seen" set from this,
     * so it must not be a table scan.
     */
    brandHashIdx: index("brand_images_brand_hash_idx").on(
      table.brandId,
      table.contentHash,
    ),
    /** The read path is always "this brand's live images, grouped". */
    brandGroupIdx: index("brand_images_brand_group_idx").on(
      table.brandId,
      table.imageGroupKey,
      table.groupSortOrder,
    ),
  }),
);

export type BrandImage = typeof brandImages.$inferSelect;
export type BrandImageInsert = typeof brandImages.$inferInsert;
