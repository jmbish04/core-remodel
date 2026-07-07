import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

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
  pricePoint: text("price_point"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Brand = typeof brands.$inferSelect;
export type BrandInsert = typeof brands.$inferInsert;
