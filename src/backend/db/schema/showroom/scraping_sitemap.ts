// src/backend/db/schema/showroom/scraping_sitemap.ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";
import { brands } from "../brands/brands";

/**
 * Scraping Sitemap (Phase B) — a persisted cache of a site's discovered page
 * list, keyed to the entity the scrape is for (brand / showroom / product).
 *
 * Today `discoverPages()` fetches a site's sitemap and throws the URL list away
 * after one use, so every scrape re-fetches it. Persisting it lets the intake
 * workflow (Phase C, per-candidate product-page scrape) reuse a recent sitemap
 * instead of hitting the site again — Browser Rendering / plain fetch is the
 * most rate-limited resource in the system.
 *
 * `productId` is a soft integer pointer (no FK) — the products table id is
 * referenced without a DB-level constraint, matching the rest of the photo
 * pipeline after the products rename.
 */
export const scrapingSitemap = sqliteTable(
  "scraping_sitemap",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** What this scrape is for — drives which entity id column is set. */
    scrapeJobType: text("scrape_job_type", {
      enum: ["brand", "showroom", "product"] as const,
    }).notNull(),

    brandId: integer("brand_id").references(() => brands.id, {
      onDelete: "set null",
    }),
    showroomId: integer("showroom_id").references(() => showroomStores.id, {
      onDelete: "set null",
    }),
    /** Soft pointer to products.id (no FK). */
    productId: integer("product_id"),

    /** The site origin/URL the discovery ran against. */
    websiteUrl: text("website_url").notNull(),
    /** The sitemap URL that actually resolved, or null on homepage fallback. */
    sitemapUrl: text("sitemap_url"),
    /** JSON string[] of discovered page URLs. */
    pageUrls: text("page_urls"),
    pageCount: integer("page_count").notNull().default(0),

    /** ok = sitemap parsed; empty = no sitemap (homepage fallback); error = fetch failed. */
    status: text("status", {
      enum: ["ok", "empty", "error"] as const,
    })
      .notNull()
      .default("ok"),

    /** When the discovery ran — freshness key for cache reuse. */
    fetchedAt: integer("fetched_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    brandIdx: index("scraping_sitemap_brand_idx").on(table.brandId),
    showroomIdx: index("scraping_sitemap_showroom_idx").on(table.showroomId),
    productIdx: index("scraping_sitemap_product_idx").on(table.productId),
  })
);

export type ScrapingSitemap = typeof scrapingSitemap.$inferSelect;
export type ScrapingSitemapInsert = typeof scrapingSitemap.$inferInsert;
