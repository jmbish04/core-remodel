import { showroomStoreLinks, showroomStores } from "@backend/db/schema/showroom/index";
import { classifySiteLink } from "@backend/services/showroom/social-links";
/**
 * @fileoverview Clearance-link discovery — find every store's sale/clearance/
 * outlet/last-chance page and register it as a `WEBSITE_CLEARANCE` link, so the
 * weekly sweep actually covers the whole directory instead of the handful of
 * stores whose clearance page a shallow scrape happened to crawl.
 *
 * PLAIN FETCH, NOT BROWSER RENDERING: a sitemap is plain XML and a homepage's
 * link list is in the server-rendered HTML — there is no JavaScript to execute,
 * so `fetch` pulls the exact same bytes a browser would, instantly and for free.
 * Browser Rendering is reserved for pages whose content only exists after JS runs.
 *
 * Per store, cheapest signal first:
 *   1. `robots.txt` `Sitemap:` lines + a `/sitemap.xml` guess → fetch each
 *      sitemap (following a sitemap INDEX one level down), collect page URLs.
 *   2. If the site publishes NO sitemap, fall back to fetching the homepage and
 *      scanning its `<a href>` links.
 * Then classify every URL with the shared {@link classifySiteLink} (own-domain
 * only; already matches clearance|sale|outlet|closeout|last-chance|… and vetoes
 * bot-challenge junk), keep the shallow LANDING pages (not deep product URLs),
 * dedupe against existing links, and insert the new ones.
 */
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

// --- Tunables --------------------------------------------------------------
const CONCURRENCY = 8;
const FETCH_TIMEOUT_MS = 8_000;
/** Sitemaps fetched per site (a sitemap index can list dozens; bound the fan-out). */
const MAX_SITEMAPS_PER_SITE = 12;
/** Page URLs harvested per site before we stop reading sitemaps. */
const MAX_URLS_PER_SITE = 10_000;
/** New clearance links added per store per run — landing pages, not every product. */
const MAX_NEW_LINKS_PER_STORE = 10;
/** Keep only clearance URLs this shallow (segments) — a section/landing page, not `/outlet/sku-123`. */
const MAX_CLEARANCE_PATH_DEPTH = 2;

export interface DiscoverySummary {
  storesScanned: number;
  sitemapsParsed: number;
  homepageFallbacks: number;
  newLinks: number;
  errors: number;
}

/** Fetch text with a timeout; transparently gunzip a `.gz` body. Null on any failure. */
async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "user-agent": "core-remodel-clearance-discovery/1.0" },
      redirect: "follow",
    });
    if (!res.ok || !res.body) return null;
    if (url.toLowerCase().endsWith(".gz")) {
      const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
      return await new Response(stream).text();
    }
    return await res.text();
  } catch {
    return null;
  }
}

/** Pull `<loc>` values; a `<sitemapindex>` means those locs are child sitemaps, not pages. */
function parseSitemap(xml: string): { urls: string[]; children: string[] } {
  const locs: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) locs.push(m[1]);
  return /<sitemapindex[\s>]/i.test(xml)
    ? { urls: [], children: locs }
    : { urls: locs, children: [] };
}

/** Absolute-resolve every `href` in a homepage's HTML. */
function extractHrefs(html: string, base: string): string[] {
  const out: string[] = [];
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      out.push(new URL(m[1], base).toString());
    } catch {
      /* skip malformed href */
    }
  }
  return out;
}

/** Sitemap URL candidates for a site: robots.txt `Sitemap:` lines + the conventional guess. */
async function sitemapCandidates(origin: string): Promise<string[]> {
  const set = new Set<string>([`${origin}/sitemap.xml`, `${origin}/sitemap_index.xml`]);
  const robots = await fetchText(`${origin}/robots.txt`);
  if (robots) {
    for (const line of robots.split("\n")) {
      const sm = /^\s*sitemap:\s*(\S+)/i.exec(line);
      if (sm) set.add(sm[1].trim());
    }
  }
  return [...set];
}

/** All page URLs for a site — via sitemap when present, else the homepage's links. */
async function gatherSiteUrls(website: string): Promise<{ urls: string[]; usedSitemap: boolean }> {
  const origin = new URL(website).origin;
  const urls = new Set<string>();
  const seen = new Set<string>();
  const queue = await sitemapCandidates(origin);
  let parsedAny = false;

  while (queue.length > 0 && seen.size < MAX_SITEMAPS_PER_SITE && urls.size < MAX_URLS_PER_SITE) {
    const sm = queue.shift()!;
    if (seen.has(sm)) continue;
    seen.add(sm);
    const body = await fetchText(sm);
    if (!body || !/<loc>/i.test(body)) continue;
    parsedAny = true;
    const { urls: pageUrls, children } = parseSitemap(body);
    for (const u of pageUrls) urls.add(u);
    for (const c of children) if (!seen.has(c)) queue.push(c);
  }

  if (!parsedAny) {
    const home = await fetchText(website);
    if (home) for (const h of extractHrefs(home, website)) urls.add(h);
    return { urls: [...urls], usedSitemap: false };
  }
  return { urls: [...urls], usedSitemap: true };
}

/** Path depth (number of non-empty segments), e.g. `/outlet/bath` → 2. */
function pathDepth(url: string): number {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return Infinity;
  }
}

/** Run `worker` over `items` with bounded concurrency. */
async function pool<T>(
  items: T[],
  size: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

/**
 * Discover and register clearance links for every active store that has a WEBSITE
 * link. Idempotent — existing links are skipped, so it is safe to run weekly.
 */
export async function discoverClearanceLinks(
  env: Env,
  opts: { limit?: number } = {},
): Promise<DiscoverySummary> {
  const db = drizzle(env.DB);
  const limit = opts.limit ?? 500;

  const websites = await db
    .select({ storeId: showroomStoreLinks.storeId, url: showroomStoreLinks.url })
    .from(showroomStoreLinks)
    .innerJoin(showroomStores, eq(showroomStoreLinks.storeId, showroomStores.id))
    .where(and(eq(showroomStoreLinks.type, "WEBSITE"), eq(showroomStores.isActive, true)))
    .limit(limit);

  // One website per store (first WEBSITE row wins).
  const siteByStore = new Map<number, string>();
  for (const w of websites) if (!siteByStore.has(w.storeId)) siteByStore.set(w.storeId, w.url);
  const sites = [...siteByStore.entries()].map(([storeId, website]) => ({ storeId, website }));

  const summary: DiscoverySummary = {
    storesScanned: 0,
    sitemapsParsed: 0,
    homepageFallbacks: 0,
    newLinks: 0,
    errors: 0,
  };

  await pool(sites, CONCURRENCY, async (site) => {
    try {
      const host = new URL(site.website).hostname;
      const { urls, usedSitemap } = await gatherSiteUrls(site.website);
      if (usedSitemap) summary.sitemapsParsed++;
      else summary.homepageFallbacks++;

      // Classify → keep shallow clearance LANDING pages, dedupe by normalized url.
      const clearance = new Map<string, string>();
      for (const u of urls) {
        const c = classifySiteLink(u, host);
        if (c?.type === "WEBSITE_CLEARANCE" && pathDepth(c.url) <= MAX_CLEARANCE_PATH_DEPTH) {
          clearance.set(c.url, c.url);
        }
      }
      if (clearance.size === 0) return;

      // Skip anything this store already has (any type — never duplicate a URL).
      const existing = await db
        .select({ url: showroomStoreLinks.url })
        .from(showroomStoreLinks)
        .where(eq(showroomStoreLinks.storeId, site.storeId));
      const have = new Set(existing.map((e) => e.url.toLowerCase()));

      const fresh = [...clearance.values()]
        .filter((u) => !have.has(u.toLowerCase()))
        .sort((a, b) => pathDepth(a) - pathDepth(b)) // landing pages first
        .slice(0, MAX_NEW_LINKS_PER_STORE);
      if (fresh.length === 0) return;

      // Single-store insert count is ≤ MAX_NEW_LINKS_PER_STORE × 4 cols = well
      // under D1's 100-param cap, so one insert is safe without chunking.
      await db
        .insert(showroomStoreLinks)
        .values(
          fresh.map((url) => ({ storeId: site.storeId, url, type: "WEBSITE_CLEARANCE" as const })),
        );
      summary.newLinks += fresh.length;
    } catch (err) {
      console.error(`[clearance-discovery] failed for store ${site.storeId}:`, err);
      summary.errors++;
    } finally {
      summary.storesScanned++;
    }
  });

  console.info(
    `[clearance-discovery] scanned ${summary.storesScanned} stores — ${summary.sitemapsParsed} via sitemap, ` +
      `${summary.homepageFallbacks} via homepage, ${summary.newLinks} new links, ${summary.errors} errors`,
  );
  return summary;
}
