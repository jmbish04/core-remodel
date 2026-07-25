import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Brands — top-level brand registry, independent of any showroom or product.
 *
 * A brand is the manufacturer or design house behind products (e.g. "THG Paris",
 * "Waterworks", "The Galley"). It is intentionally a leaf table — it imports
 * nothing from other domains, keeping the module graph acyclic so that
 * showroom and other domains can safely import from here without circular refs.
 *
 * The `iconCfImagesUrl` column holds the brand's favicon / logo as delivered
 * through Cloudflare Images. The favicon worker writes here when it resolves
 * the brand's website icon. Individual brand-type mapping rows may additionally
 * carry their own `brandIconCfImagesUrl` for type-specific overrides.
 */
export const brands = sqliteTable("brands", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Official brand name. */
  name: text("name").notNull(),

  /** Short prose description of the brand's positioning / specialty. */
  description: text("description"),

  /** Brand's primary website URL. */
  websiteUrl: text("website_url"),

  /** Public Instagram profile URL for the brand. */
  instagramUrl: text("instagram_url"),

  /** Public Facebook page URL for the brand. */
  facebookUrl: text("facebook_url"),

  /** Public Pinterest profile URL for the brand. */
  pinterestUrl: text("pinterest_url"),

  /**
   * Cloudflare Images delivery URL of the brand's scraped favicon / logo.
   * Auto-populated by the favicon worker when `websiteUrl` is set or changed.
   * Example: "https://imagedelivery.net/<accountHash>/<imageId>/public"
   */
  iconCfImagesUrl: text("icon_cf_images_url"),

  /**
   * Freeform homeowner notes on the brand (plain text; shown in a Textarea).
   * Nullable — populated only when the homeowner has something to say about
   * this brand. Not synced from any external source.
   */
  personalNotes: text("personal_notes"),

  /**
   * Aggregate online / consensus rating for the brand on a 0–5 scale.
   * Sourced from public review aggregators (e.g. Google, Yelp). Nullable —
   * not all brands have a meaningful aggregate score.
   */
  onlineRating: real("online_rating"),

  /**
   * The homeowner's personal rating of the brand on a 0–5 scale.
   * Nullable — populated only after the homeowner has had enough experience
   * to form a considered opinion.
   */
  userRating: real("user_rating"),

  /**
   * Relative price tier for the brand: '$' | '$$' | '$$$' | '$$$$'.
   * Best-effort estimate produced by the brand-enrichment pipeline (Workers-AI)
   * when a newly-discovered brand is first inserted. Nullable — not all brands
   * have enough public signal to classify.
   */
  /**
   * Soft delete. A duplicate brand is deactivated, never DELETEd: every FK into
   * `brands` is ON DELETE CASCADE, so removing the row would take its showroom
   * mappings, type mappings, product links and intel with it. Deactivating
   * hides it from every list while the merge repoints those rows.
   */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  pricePoint: text("price_point"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
}, (table) => ({
  /**
   * Durable dedup guard (ops #4). Two ACTIVE brands may not share a normalized
   * name key. The key lowercases, trims, then strips spaces/dots/commas so the
   * case+spacing restatements a bulk import forked into two rows collapse to one
   * — "Newport Brass" vs "NEWPORTBRASS", "Dornbracht" vs "DORN BRACHT". Added
   * only AFTER the 0118 dedup pass cleared existing collisions (verified 0 among
   * active brands). PARTIAL on `is_active = 1` on purpose: dedup soft-deletes the
   * loser (keeps its row for FK history), so a retired brand must stay free to
   * hold a name key a survivor now also holds — a full index would refuse to
   * create (6 such active/retired collisions measured). This does NOT catch
   * suffix variants ("Visual Comfort" vs "Visual Comfort & Co.", which differ as
   * strings even after stripping) — those stay the intake layer's job to
   * reconcile.
   */
  nameKeyUniq: uniqueIndex("brands_name_key_uniq")
    .on(sql`replace(replace(replace(lower(trim(${table.name})),' ',''),'.',''),',','')`)
    .where(sql`${table.isActive} = 1`),
}));

export type Brand = typeof brands.$inferSelect;
export type BrandInsert = typeof brands.$inferInsert;
