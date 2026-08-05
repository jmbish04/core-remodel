import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Showroom Brands — one row per unique brand in the system.
 *
 * A brand like "Kohler" exists once here, mapped to many stores via
 * `store_brand_mapping`. The ShowroomResearchAgent's browser scraping
 * pipeline populates this table: it checks D1 before inserting (slug
 * UNIQUE constraint as safety net), uploads the brand logo to Cloudflare
 * Images, and stores the delivery URL here.
 */
export const showroomBrands = sqliteTable(
  "showroom_brands",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Display name — "Kohler", "Moen", "Delta Faucet", etc. */
    name: text("name").notNull(),

    /** URL-safe slug — "kohler", "moen", "delta-faucet". Used for dedup. */
    slug: text("slug").notNull(),

    // ── Visual identity (CF Images) ─────────────────────────────────────
    logoCfImageId: text("logo_cf_image_id"),
    logoCfDeliveryUrl: text("logo_cf_delivery_url"),

    // ── Brand metadata ──────────────────────────────────────────────────
    websiteUrl: text("website_url"),
    description: text("description"),

    pricePoint: text("price_point", {
      enum: ["$", "$$", "$$$", "$$$$"],
    }),

    /** Average online rating aggregated from review platforms (1.0–5.0). */
    avgRating: real("avg_rating"),

    /** Number of ratings aggregated to compute avgRating. */
    ratingCount: integer("rating_count").default(0),

    countryOfOrigin: text("country_of_origin"),

    isActive: integer("is_active", { mode: "boolean" }).default(true),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    slugUnique: uniqueIndex("showroom_brands_slug_unique").on(table.slug),
    nameIdx: index("showroom_brands_name_idx").on(table.name),
  }),
);

export type ShowroomBrand = typeof showroomBrands.$inferSelect;
export type ShowroomBrandInsert = typeof showroomBrands.$inferInsert;
