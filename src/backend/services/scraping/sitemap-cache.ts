// src/backend/services/scraping/sitemap-cache.ts
/**
 * @fileoverview Persisted sitemap cache (Phase B).
 *
 * Wraps `discoverSitemap()` so a site's discovered page list is stored in
 * `scraping_sitemap` and reused within a freshness window instead of re-fetching.
 * Browser Rendering / plain fetch against brand sites is the most rate-limited
 * resource in the system; a sitemap changes on the order of days, so caching it
 * per entity is a large, safe saving. Phase C's per-candidate product-page scrape
 * is the main consumer.
 */
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, gte } from "drizzle-orm";

import { scrapingSitemap, type ScrapingSitemap } from "@backend/db/schema/showroom/index";
import { discoverSitemap, type SitemapDiscovery } from "@backend/services/brands/brand-image-harvest";

type Db = ReturnType<typeof drizzle>;

export interface SitemapContext {
  scrapeJobType: "brand" | "showroom" | "product";
  brandId?: number | null;
  showroomId?: number | null;
  productId?: number | null;
}

/** Default reuse window — sitemaps change slowly; a week-old page list is fine. */
export const DEFAULT_SITEMAP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The entity-id column that identifies this context's owner. */
function ownerEq(ctx: SitemapContext) {
  if (ctx.scrapeJobType === "brand") return eq(scrapingSitemap.brandId, ctx.brandId ?? -1);
  if (ctx.scrapeJobType === "showroom") return eq(scrapingSitemap.showroomId, ctx.showroomId ?? -1);
  return eq(scrapingSitemap.productId, ctx.productId ?? -1);
}

/** Most recent cached sitemap for this entity + url within `maxAgeMs`, or null. */
export async function getFreshSitemap(
  db: Db,
  ctx: SitemapContext,
  websiteUrl: string,
  maxAgeMs: number = DEFAULT_SITEMAP_MAX_AGE_MS,
): Promise<ScrapingSitemap | null> {
  const cutoff = new Date(nowMs() - maxAgeMs);
  const [row] = await db
    .select()
    .from(scrapingSitemap)
    .where(
      and(
        eq(scrapingSitemap.scrapeJobType, ctx.scrapeJobType),
        ownerEq(ctx),
        eq(scrapingSitemap.websiteUrl, websiteUrl),
        gte(scrapingSitemap.fetchedAt, cutoff),
      ),
    )
    .orderBy(desc(scrapingSitemap.fetchedAt))
    .limit(1);
  return row ?? null;
}

/** Insert a discovery result as a cache row. */
export async function cacheSitemap(
  db: Db,
  ctx: SitemapContext,
  websiteUrl: string,
  discovery: SitemapDiscovery,
): Promise<void> {
  await db.insert(scrapingSitemap).values({
    scrapeJobType: ctx.scrapeJobType,
    brandId: ctx.brandId ?? null,
    showroomId: ctx.showroomId ?? null,
    productId: ctx.productId ?? null,
    websiteUrl,
    sitemapUrl: discovery.sitemapUrl,
    pageUrls: JSON.stringify(discovery.pageUrls),
    pageCount: discovery.pageUrls.length,
    status: discovery.status,
  });
}

/**
 * Discover a site's page list, reusing a fresh cached row when present.
 * On a cache miss (or stale), runs `discoverSitemap`, persists it, and returns
 * the page urls. Persisting never blocks the caller's result on a write failure.
 */
export async function discoverPagesCached(
  env: Env,
  websiteUrl: string,
  ctx: SitemapContext,
  maxAgeMs: number = DEFAULT_SITEMAP_MAX_AGE_MS,
): Promise<string[]> {
  const db = drizzle(env.DB);

  const cached = await getFreshSitemap(db, ctx, websiteUrl, maxAgeMs).catch(() => null);
  if (cached?.pageUrls) {
    try {
      const urls = JSON.parse(cached.pageUrls) as string[];
      if (Array.isArray(urls) && urls.length > 0) return urls;
    } catch {
      // fall through to a fresh discovery
    }
  }

  const discovery = await discoverSitemap(websiteUrl);
  await cacheSitemap(db, ctx, websiteUrl, discovery).catch((err) => {
    console.error("[sitemap-cache] persist failed:", err);
  });
  return discovery.pageUrls;
}

/** `Date.now()` isolated so the workflow-script sandbox rule never trips here
 *  (this file is normal worker code; kept explicit for grep-ability). */
function nowMs(): number {
  return Date.now();
}
