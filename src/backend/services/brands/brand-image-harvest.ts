/**
 * @fileoverview Harvest brand imagery from a brand's own website — worker
 * `fetch` only, no Browser Rendering, no CF Images.
 *
 * PORTED FROM `scripts/extract_brand_images_demo.ts`. The pipeline, the
 * thresholds and the two dedupe sets are that script's, unchanged. Four
 * substitutions were forced by the Workers runtime:
 *
 *   | demo script            | here                        | why                  |
 *   |------------------------|-----------------------------|----------------------|
 *   | `cheerio.load()`       | `HTMLRewriter`              | cheerio buffers the  |
 *   |                        |                             | whole DOM; the       |
 *   |                        |                             | runtime streams it   |
 *   | `createHash('sha256')` | `crypto.subtle.digest`      | no node:crypto       |
 *   | `writeFile`/`mkdir`    | D1 insert                   | no filesystem        |
 *   | `Buffer.from()`        | `Uint8Array`                | no Buffer            |
 *
 * `image-size` stays — it is pure JS, accepts a `Uint8Array`, and works on
 * Workers PROVIDED you import the package root only. The `image-size/fromFile`
 * subpath pulls in `node:fs` and fails the build.
 *
 * WHY NO CF IMAGES. Brand imagery is the brand's own marketing photography,
 * already served from their CDN. Copying it into CF Images pays storage +
 * delivery for a second copy of an asset that is already free — for tens of
 * thousands of images. We store the SOURCE url and hotlink it.
 *
 * The cost of that choice is liveness: a source url can 404 or start blocking
 * hotlinks at any time, and it fails in the BROWSER, where the worker cannot
 * see it. `is_active` + the frontend report-back path is the other half of this
 * design, not an afterthought.
 */

import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import imageSize from "image-size";

import { brandImages } from "@backend/db/schema/brands/brand_images";

// ---------------------------------------------------------------------------
// Thresholds — verbatim from the demo script
// ---------------------------------------------------------------------------

/** Below this is a spacer, a tracking pixel or an icon, never a product photo. */
const MIN_BYTES = 5 * 1024;
const MIN_WIDTH = 150;
const MIN_HEIGHT = 150;

/**
 * Above this we refuse to buffer. Not in the demo script — it ran on a laptop
 * with GBs of heap; a Worker has 128MB and one 40MB hero TIFF ends the request
 * for every other image in the batch.
 */
const MAX_BYTES = 12 * 1024 * 1024;

/** Bounded so one enormous sitemap cannot run the request out of CPU time. */
const MAX_PAGES_PER_RUN = 40;
const MAX_IMAGES_PER_RUN = 300;

/**
 * Rows buffered before a `db.batch()` flush.
 *
 * Inserting one row per image costs a D1 roundtrip each; batching amortises
 * that. Flushing PERIODICALLY rather than once at the end is the deliberate
 * part: this function fetches up to 300 images over many seconds, and a single
 * end-of-run flush means a timeout at image 280 discards all 280.
 *
 * `db.batch()` of single-row inserts, not one multi-row INSERT — D1 caps a
 * query at 100 bound parameters and these rows carry 12 columns each, so a
 * multi-row statement would blow that limit at nine rows.
 */
const INSERT_BATCH_SIZE = 50;

/**
 * `delivery_url` is NOT NULL and predates this design, when every image really
 * did get a CF Images delivery url. Rather than migrate a column that older
 * rows still legitimately populate, new rows carry this sentinel: it reads as
 * an explanation in a raw D1 dump, and it is greppable, so any read path still
 * reaching for `delivery_url` on a harvested row is obvious on sight instead of
 * rendering a broken image.
 */
export const CF_IMAGES_SKIPPED = "saving cf image usage - use brand image src";

const SITEMAP_CANDIDATES = [
  "/sitemap.xml",
  "/sitemap_index.xml",
  "/sitemap-index.xml",
  "/wp-sitemap.xml",
];

export interface HarvestResult {
  brandId: number;
  pagesScanned: number;
  imagesConsidered: number;
  imagesKept: number;
  skipped: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------

/**
 * Resolve a brand's website to a list of page urls.
 *
 * Sitemap-driven, like the demo script, because crawling by following links
 * costs a fetch per page just to discover the next one; a sitemap is the site
 * telling you its own page list in one request.
 *
 * Index sitemaps (a sitemap of sitemaps) are followed one level — that is the
 * common shape, and unbounded recursion on an attacker-controlled xml file is
 * not something to hand a worker.
 */
export async function discoverPages(websiteUrl: string): Promise<string[]> {
  let origin: string;
  try {
    origin = new URL(websiteUrl).origin;
  } catch {
    return [];
  }

  for (const path of SITEMAP_CANDIDATES) {
    const urls = await readSitemap(`${origin}${path}`);
    if (urls.length === 0) continue;

    // An index sitemap's <loc>s are themselves .xml. Follow one level.
    const nested = urls.filter((u) => u.toLowerCase().endsWith(".xml"));
    if (nested.length > 0 && nested.length === urls.length) {
      const pages: string[] = [];
      for (const child of nested.slice(0, 5)) {
        pages.push(...(await readSitemap(child)).filter((u) => !u.endsWith(".xml")));
        if (pages.length >= MAX_PAGES_PER_RUN) break;
      }
      if (pages.length > 0) return pages.slice(0, MAX_PAGES_PER_RUN);
      continue;
    }

    return urls.filter((u) => !u.endsWith(".xml")).slice(0, MAX_PAGES_PER_RUN);
  }

  // No sitemap — the homepage alone still yields the hero imagery.
  return [websiteUrl];
}

/** `<loc>` extraction by regex, as the demo script does — no XML parser needed. */
async function readSitemap(url: string): Promise<string[]> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/xml,text/xml" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)]
      .map((m) => m[1].trim())
      .filter((u) => u.startsWith("http"));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Page scan
// ---------------------------------------------------------------------------

/**
 * Collect absolute `<img>` srcs from a page.
 *
 * HTMLRewriter replaces cheerio here. It is streaming, so the HTML never lands
 * in memory as one string — which also means `element.getAttribute` is the only
 * way in; there is no document to query afterwards.
 *
 * `srcset` is read too (the demo script only took `src`): responsive markup
 * routinely leaves `src` on a 1px placeholder and puts every real candidate in
 * `srcset`, so src-only silently misses the actual photography.
 */
async function collectImageUrls(pageUrl: string): Promise<Set<string>> {
  const found = new Set<string>();

  const res = await fetch(pageUrl, {
    headers: { accept: "text/html", "user-agent": "core-remodel-brand-harvester" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return found;

  const add = (raw: string | null) => {
    if (!raw) return;
    try {
      const abs = new URL(raw.trim(), pageUrl).href;
      if (abs.startsWith("http")) found.add(abs);
    } catch {
      // Malformed url — ignored, exactly as the demo script does.
    }
  };

  await new HTMLRewriter()
    .on("img", {
      element(el) {
        add(el.getAttribute("src"));
        // Lazy-loading libraries park the real url here and leave src blank.
        add(el.getAttribute("data-src"));
        const srcset = el.getAttribute("srcset") ?? el.getAttribute("data-srcset");
        if (srcset) {
          for (const part of srcset.split(",")) add(part.trim().split(/\s+/)[0]);
        }
      },
    })
    .transform(res)
    .arrayBuffer();

  return found;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Derive a stable group key + sort order from an image url.
 *
 * A brand shoot arrives as one hero plus N gallery frames of the SAME product,
 * and the filenames say so. Real gessi.com set:
 *
 *   Collezione_Origini_warm_Gessi_HERO_9f2c.jpg
 *   Collezione_Origini_warm_Gessi_gallery_1_9f2c.jpg
 *   … gallery_11 …
 *
 * Strip the `HERO`/`gallery_N` marker and the cache-buster tail and all twelve
 * collapse to `collezione_origini_warm_gessi`. Without this the UI renders a
 * shuffled wall of near-identical frames from a dozen different products.
 *
 * Exported for the unit test — the regex is the whole feature, so it is the
 * thing worth testing directly.
 */
export function deriveGroup(imageUrl: string): {
  key: string | null;
  sortOrder: number;
} {
  let stem: string;
  try {
    stem = new URL(imageUrl).pathname.split("/").pop() ?? "";
  } catch {
    return { key: null, sortOrder: 999 };
  }
  stem = stem.replace(/\.[a-z0-9]{2,5}$/i, "");
  if (!stem) return { key: null, sortOrder: 999 };

  // HERO sorts first; gallery_N sorts by N; anything else lands after both.
  let sortOrder = 999;
  const marker = stem.match(/[_-](hero|gallery[_-]?(\d+))(?:[_-]|$)/i);
  if (marker) {
    sortOrder = marker[2] ? Number.parseInt(marker[2], 10) : 0;
  }

  const key = stem
    // Drop the marker and everything after it — that tail is the cache-buster.
    .replace(/[_-](hero|gallery[_-]?\d+)(?:[_-].*)?$/i, "")
    // Trailing content hashes and dimension suffixes are per-variant noise.
    .replace(/[_-](?:[0-9a-f]{6,}|\d{2,4}x\d{2,4})$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  return { key: key || null, sortOrder };
}

// ---------------------------------------------------------------------------
// Harvest
// ---------------------------------------------------------------------------

/** SHA-256 hex of the image bytes. Web Crypto stand-in for node:crypto. */
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // `bytes.buffer` rather than `bytes`: a Uint8Array view is not structurally a
  // BufferSource under the Workers types, and `byteLength` is the whole buffer
  // here because it came straight from `arrayBuffer()` with no sub-viewing.
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Harvest a brand's imagery into `brand_images`.
 *
 * NEVER throws — a brand whose site is down must not fail the workflow step
 * that called it. Every skip reason is counted and returned so a run that keeps
 * zero images explains why rather than looking like a silent success.
 */
export async function harvestBrandImages(
  env: Env,
  brandId: number,
  websiteUrl: string,
): Promise<HarvestResult> {
  const db = drizzle(env.DB);
  const skipped: Record<string, number> = {};
  const skip = (reason: string, count = 1) => {
    skipped[reason] = (skipped[reason] ?? 0) + count;
  };

  // Seed both dedupe sets from D1, not just from this run. The demo script's
  // sets were per-process because it started empty every time; here a re-run
  // over the same brand would otherwise re-fetch and re-insert everything.
  const existing = await db
    .select({
      sourceUrl: brandImages.sourceUrl,
      contentHash: brandImages.contentHash,
    })
    .from(brandImages)
    .where(eq(brandImages.brandId, brandId));

  const seenUrls = new Set(existing.map((r) => r.sourceUrl));
  const seenHashes = new Set(
    existing.map((r) => r.contentHash).filter((h): h is string => Boolean(h)),
  );

  let pagesScanned = 0;
  let imagesConsidered = 0;
  let imagesKept = 0;

  const pending: Array<typeof brandImages.$inferInsert> = [];

  /**
   * Write the buffered rows and return how many were written. Returns 0 and
   * keeps going on failure — losing one batch of imagery must not abort a
   * harvest that has already paid for hundreds of image fetches.
   */
  const flush = async (): Promise<number> => {
    if (pending.length === 0) return 0;
    const chunk = pending.splice(0, pending.length);
    try {
      const statements = chunk.map((row) =>
        db.insert(brandImages).values(row).onConflictDoNothing(),
      );
      await db.batch(
        statements as unknown as [(typeof statements)[number], ...typeof statements],
      );
      return chunk.length;
    } catch (err) {
      console.error(`[brand-harvest] batch insert failed for brand ${brandId}:`, err);
      // Count the ROWS lost, not the batch — the histogram is a diagnostic,
      // and "1 failure" reads very differently from "50 images dropped".
      skip("insert_failed", chunk.length);
      return 0;
    }
  };

  const pages = await discoverPages(websiteUrl);

  for (const pageUrl of pages) {
    if (imagesConsidered >= MAX_IMAGES_PER_RUN) break;

    let pageImages: Set<string>;
    try {
      pageImages = await collectImageUrls(pageUrl);
    } catch {
      skip("page_fetch_failed");
      continue;
    }
    pagesScanned++;

    for (const imgUrl of pageImages) {
      if (imagesConsidered >= MAX_IMAGES_PER_RUN) break;
      if (seenUrls.has(imgUrl)) continue;
      seenUrls.add(imgUrl);
      imagesConsidered++;

      try {
        const res = await fetch(imgUrl, { signal: AbortSignal.timeout(15_000) });
        if (!res.ok) {
          skip(`http_${res.status}`);
          continue;
        }

        // Cheap pre-check the demo script had no reason to do: reject on the
        // advertised length BEFORE buffering, so a 40MB asset costs a header
        // read rather than 40MB of a 128MB heap.
        const declared = Number(res.headers.get("content-length") ?? "0");
        if (declared > MAX_BYTES) {
          skip("too_large");
          continue;
        }

        const bytes = new Uint8Array(await res.arrayBuffer());

        if (bytes.byteLength < MIN_BYTES) {
          skip("too_small");
          continue;
        }
        if (bytes.byteLength > MAX_BYTES) {
          // Servers lie about (or omit) content-length; re-check after the fact.
          skip("too_large");
          continue;
        }

        const hash = await sha256Hex(bytes);
        if (seenHashes.has(hash)) {
          skip("duplicate_content");
          continue;
        }

        let width: number | undefined;
        let height: number | undefined;
        let mime: string | null = null;
        try {
          const dim = imageSize(bytes);
          width = dim.width;
          height = dim.height;
          // Trust the sniffed type over the server's content-type header —
          // image CDNs routinely mislabel, and this is decoded from the bytes.
          mime = dim.type ? `image/${dim.type}` : null;
        } catch {
          skip("undecodable");
          continue;
        }

        if (!width || !height) {
          skip("no_dimensions");
          continue;
        }
        if (width < MIN_WIDTH || height < MIN_HEIGHT) {
          skip("too_few_pixels");
          continue;
        }

        seenHashes.add(hash);
        const group = deriveGroup(imgUrl);

        pending.push({
          brandId,
          sourceUrl: imgUrl,
          sourcePageUrl: pageUrl,
          deliveryUrl: CF_IMAGES_SKIPPED,
          mimeType: mime,
          width,
          height,
          byteSize: bytes.byteLength,
          contentHash: hash,
          imageGroupKey: group.key,
          groupSortOrder: group.sortOrder,
          isActive: true,
        });

        if (pending.length >= INSERT_BATCH_SIZE) imagesKept += await flush();
      } catch {
        skip("fetch_failed");
      }
    }
  }

  imagesKept += await flush();

  return { brandId, pagesScanned, imagesConsidered, imagesKept, skipped };
}

/**
 * Mark an image dead. Called by the frontend when the browser — not the worker
 * — fails to load the source url, which is the only place that failure is
 * visible when the asset is hotlinked from the brand's own CDN.
 */
export async function deactivateBrandImage(
  env: Env,
  sourceUrl: string,
  reason: string,
): Promise<boolean> {
  const db = drizzle(env.DB);
  const rows = await db
    .update(brandImages)
    .set({ isActive: false, inactiveReason: reason, updatedAt: new Date() })
    .where(and(eq(brandImages.sourceUrl, sourceUrl), eq(brandImages.isActive, true)))
    .returning({ id: brandImages.id });
  return rows.length > 0;
}
