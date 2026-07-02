import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Brand = typeof brands.$inferSelect;
export type BrandInsert = typeof brands.$inferInsert;
