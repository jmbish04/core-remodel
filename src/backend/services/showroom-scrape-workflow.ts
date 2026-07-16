/**
 * @fileoverview Post-submit showroom website SCRAPE workflow.
 *
 * When a showroom store is created (or manually re-triggered) with a
 * `websiteUrl`, this Cloudflare Workflow crawls the site with Browser Rendering,
 * archives each page's markdown to R2, screenshots to Cloudflare Images, embeds
 * the text into the `RESEARCH_INDEX` Vectorize corpus (tagged by `ragUuid`), and
 * runs a Workers-AI structured extraction per page to recover brand names, an
 * Instagram URL, appointment-only status, hours text, and a hero image.
 *
 * Aggregation then hydrates the showroom's Instagram URL, hero image, and brand
 * mappings, and hydrates the favicon.
 *
 * Each `step.do(...)` unit is independently retryable. The whole `run` body is
 * wrapped so any unrecoverable failure flips `showroom_stores.scrape_status` to
 * "failed" before re-throwing (so Workflows records the error).
 *
 * BOUNDS: at most ~10 pages per run to stay within Browser Rendering / AI limits.
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  browserRunPages,
  showroomStoreLinks,
  showroomStores,
} from "@backend/db/schema/showroom/index";
import { brands, showroomBrandMappings } from "@backend/db/schema/brands/index";
import { normalizeCrawlUrl, scrapeUrl } from "@backend/ai/tools/browser-rendering";
import { chunkMarkdown } from "@backend/ai/agents/ResearchAgent/methods/chunk-markdown";
import { ImageProcessorService } from "@backend/services/image-processor";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";
import { parseStructuredResponse } from "@backend/utils/ai-json";
import { faviconService } from "@backend/services/favicon";
import { enrichNewBrand } from "@backend/services/showroom/brand-enrichment";
import { collectSocialLinks } from "@backend/services/showroom/social-links";
import { extractBrandFacets, type FacetBrand } from "@backend/services/showroom/brand-facets";

// ---------------------------------------------------------------------------
// Params + constants
// ---------------------------------------------------------------------------

export interface ShowroomScrapeParams {
  showroomId: number;
  websiteUrl: string;
  ragUuid: string;
}

/** Workers-AI embedding model — mirrors the deep-sweep RAG pipeline. */
const EMBED_MODEL = "@cf/baai/bge-large-en-v1.5" as const;

/** Workers-AI instruct model used for per-page structured extraction. */
const EXTRACT_MODEL = "@cf/moonshotai/kimi-k2.6" as const;

/** Hard cap on the number of pages crawled per run. */
const MAX_PAGES = 10;

/** Link rows per db.batch — keeps each query under D1's 100-bound-parameter cap. */
const LINK_INSERT_CHUNK = 50;

/**
 * Cap on how many NEWLY-DISCOVERED brands get `enrichNewBrand`'d per scrape.
 *
 * Deterministic facet extraction took store #132 from 6 brands to 137, which is
 * the point — but enrichNewBrand costs ~2 AI calls + a search + an icon fetch
 * EACH, so an uncapped run would fire ~260 paid calls for one store, times ~130
 * stores in a backfill. The brands are all still recorded; the ones past the cap
 * simply keep the name + websiteUrl we already scraped for free (which is most
 * of what enrichment would have discovered anyway) and can be enriched later
 * from a user-triggered surface. Whatever is skipped is logged, never silent.
 */
const MAX_BRAND_ENRICHMENTS_PER_SCRAPE = 8;

/** Path fragments we prioritize when selecting pages to crawl. */
const PRIORITY_PATH_RE =
  /about|brands|lines|location|contact|hours|showroom|shop|store|products|catalog|collections|browse/i;

/** Per-page structured extraction shape returned by Workers AI. */
interface PageExtraction {
  brandNames: string[];
  instagramUrl: string | null;
  appointmentOnly: boolean | null;
  hoursText: string | null;
  heroImageUrl: string | null;
}

/** JSON Schema constraining the Workers-AI structured extraction. */
const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    brandNames: { type: "array", items: { type: "string" } },
    instagramUrl: { type: ["string", "null"] },
    appointmentOnly: { type: ["boolean", "null"] },
    hoursText: { type: ["string", "null"] },
    heroImageUrl: { type: ["string", "null"] },
  },
  required: ["brandNames"],
} as const;

// ---------------------------------------------------------------------------
// Access-level classification (homeowner access to the showroom)
// ---------------------------------------------------------------------------

/** The canonical homeowner access-level enum (mirrors `showroom_stores.access_level`). */
const ACCESS_LEVEL_VALUES = [
  "PUBLIC_UNRESTRICTED",
  "STRICT_TRADE_ONLY",
  "HYBRID_ACCOMPANIED",
  "HYBRID_DEALER_NETWORK",
  "HYBRID_APPOINTMENT_ONLY",
  "UNKNOWN",
] as const;

type AccessLevel = (typeof ACCESS_LEVEL_VALUES)[number];

/** Zod schema for parsing/validating the Workers-AI classification response. */
const AccessLevelResult = z.object({
  access_level: z.enum(ACCESS_LEVEL_VALUES),
  reasoning: z.string(),
  requires_trade_rep: z.boolean(),
});

type AccessLevelResultShape = z.infer<typeof AccessLevelResult>;

/** JSON Schema constraining the Workers-AI access-level classification. */
const ACCESS_LEVEL_SCHEMA = {
  type: "object",
  properties: {
    access_level: {
      type: "string",
      enum: [...ACCESS_LEVEL_VALUES],
    },
    reasoning: { type: "string" },
    requires_trade_rep: { type: "boolean" },
  },
  required: ["access_level", "reasoning", "requires_trade_rep"],
} as const;

/** Access-level classifications that inherently require a trade rep to visit/buy. */
const TRADE_REP_IMPLIED: ReadonlySet<AccessLevel> = new Set<AccessLevel>([
  "STRICT_TRADE_ONLY",
  "HYBRID_ACCOMPANIED",
]);

/** Path/content fragments we prioritize when assembling the classification text. */
const ACCESS_PRIORITY_RE = /about|visit|faq|trade/i;

/** Character budget for the combined text handed to the classifier (~token budget). */
const ACCESS_LEVEL_CHAR_BUDGET = 12_000;

/** System instruction driving the homeowner access-level classification. */
const ACCESS_LEVEL_SYSTEM_INSTRUCTION = `You are an expert analyst classifying the Homeowner Access Level of stone, tile, and fixture showrooms. Many showrooms use wishy-washy language about public access: some allow homeowners to browse but not buy (purchases go through a dealer network), others require homeowners to be physically accompanied by a licensed trade professional. Evaluate the scraped website text and classify the showroom into EXACTLY ONE of these enum values:
- PUBLIC_UNRESTRICTED: open to the general public for BOTH browsing AND purchasing.
- STRICT_TRADE_ONLY: explicitly closed to homeowners; requires a trade account, business license, or design credential to enter or book.
- HYBRID_ACCOMPANIED: homeowners allowed ONLY if physically accompanied by their registered interior designer, architect, or contractor.
- HYBRID_DEALER_NETWORK: homeowners may visit/browse/select, but all purchases/pricing/transactions must be facilitated through a licensed trade partner or authorized dealer network.
- HYBRID_APPOINTMENT_ONLY: open to homeowners but strictly requires a pre-booked appointment (no walk-ins).
Scan the 'About Us', 'Visit Us', 'FAQ', and 'Trade Program' sections specifically. Look for trigger phrases such as: 'accompanied by a design professional', 'purchases must be facilitated through', 'dealer network', 'open to the public to browse', 'professional environment'. If the text does not contain enough signal to decide, return UNKNOWN. Return the selected enum value, a concise reasoning string quoting the exact policy/phrase that drove the decision, and requires_trade_rep = true when a homeowner needs a contractor/designer to either visit OR buy.`;

/** A scraped page's URL + markdown, retained for access-level classification. */
interface ScrapedPageText {
  pageUrl: string;
  markdown: string;
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export class ShowroomScrapeWorkflow extends WorkflowEntrypoint<
  Env,
  ShowroomScrapeParams
> {
  async run(event: WorkflowEvent<ShowroomScrapeParams>, step: WorkflowStep) {
    const { showroomId, websiteUrl, ragUuid } = event.payload;
    const env = this.env;
    const db = drizzle(env.DB);

    try {
      // ── 1. mark-running ─────────────────────────────────────────────────
      await step.do("mark-running", async () => {
        await db
          .update(showroomStores)
          .set({ scrapeStatus: "running", ragUuid, updatedAt: new Date() })
          .where(eq(showroomStores.id, showroomId));
      });

      // ── 2. discover-links ───────────────────────────────────────────────
      const pageUrls = await step.do("discover-links", async () =>
        discoverLinks(env, websiteUrl),
      );

      // ── 3. scrape-<i> per page ──────────────────────────────────────────
      // Each page is its own retryable step. We accumulate the extractions so
      // aggregate can hydrate Instagram / hero / brands afterward.
      const extractions: PageExtraction[] = [];
      const pageTexts: ScrapedPageText[] = [];
      // Every link seen across the crawl. The href drives social-profile
      // classification (header/footer icons); the anchor TEXT drives brand-facet
      // extraction ("THG Paris" from <a href="/shop?brand=thg-paris">). The text
      // used to be discarded here, which is why the shop sidebar went unread.
      const allLinks: Array<{ href: string; text?: string }> = [];
      // Brands recovered deterministically from each page's links.
      const allFacetBrands: FacetBrand[] = [];
      const siteHost = safeHost(websiteUrl);

      for (let i = 0; i < pageUrls.length && i < MAX_PAGES; i++) {
        const pageUrl = pageUrls[i];
        const { markdown, links, facetBrands, ...extraction } = await step.do(
          `scrape-${i}`,
          async () => scrapePage(env, showroomId, ragUuid, pageUrl, siteHost),
        );
        extractions.push(extraction);
        pageTexts.push({ pageUrl, markdown });
        allLinks.push(...links);
        allFacetBrands.push(...facetBrands);
      }

      // ── 4. favicon ──────────────────────────────────────────────────────
      await step.do("favicon", async () => {
        await faviconService.hydrateShowroomIcon(env, showroomId, websiteUrl);
      });

      // ── 5. aggregate ────────────────────────────────────────────────────
      await step.do("aggregate", async () =>
        aggregate(env, showroomId, extractions, allLinks, websiteUrl, allFacetBrands),
      );

      // ── 5b. classify-access-level ───────────────────────────────────────
      // Classify the showroom's homeowner ACCESS LEVEL from the aggregated
      // scraped text and persist accessLevel / accessLevelReasoning /
      // isTradeRepRequired. Never throws — falls back to UNKNOWN on failure.
      await step.do("classify-access-level", async () =>
        classifyAccessLevel(env, showroomId, pageTexts),
      );

      // ── 6. mark-complete ────────────────────────────────────────────────
      await step.do("mark-complete", async () => {
        await db
          .update(showroomStores)
          .set({ scrapeStatus: "complete", updatedAt: new Date() })
          .where(eq(showroomStores.id, showroomId));
      });
    } catch (error) {
      // Any unrecoverable failure flips status to "failed" then re-throws so
      // Log the REASON, not just the fact. Re-throwing alone parks the message
      // inside the Workflows instance record, where it is invisible to
      // `query_worker_observability` — so prod shows 44 stores flipping to
      // "failed" with no logged cause, and the only way to read it is
      // `wrangler workflows instances describe <id>`. That gap turned a one-line
      // Vectorize id bug into an afternoon of guessing from symptoms.
      console.error(
        `showroom-scrape: workflow failed for showroom ${showroomId}:`,
        error,
      );
      try {
        await db
          .update(showroomStores)
          .set({ scrapeStatus: "failed", updatedAt: new Date() })
          .where(eq(showroomStores.id, showroomId));
      } catch (markErr) {
        console.error(
          `showroom-scrape: failed to mark showroom ${showroomId} failed`,
          markErr,
        );
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Step 2 — link discovery
// ---------------------------------------------------------------------------

async function discoverLinks(env: Env, websiteUrl: string): Promise<string[]> {
  const landing = await scrapeUrl(env, websiteUrl);

  let landingHost: string;
  try {
    landingHost = new URL(websiteUrl).host;
  } catch {
    return [websiteUrl];
  }

  const seen = new Set<string>();
  const normalizedLanding = normalizeUrl(websiteUrl);
  const prioritized: string[] = [];
  const rest: string[] = [];

  // Always include the landing page first.
  if (normalizedLanding) {
    seen.add(normalizedLanding);
  }

  for (const link of landing.links) {
    const normalized = normalizeUrl(link.href, websiteUrl);
    if (!normalized) continue;

    let host: string;
    let pathname: string;
    try {
      const u = new URL(normalized);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      host = u.host;
      pathname = u.pathname;
    } catch {
      continue;
    }

    // Same-domain only.
    if (host !== landingHost) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    if (PRIORITY_PATH_RE.test(pathname)) {
      prioritized.push(normalized);
    } else {
      rest.push(normalized);
    }
  }

  const ordered = [
    ...(normalizedLanding ? [normalizedLanding] : []),
    ...prioritized,
    ...rest,
  ];

  return ordered.slice(0, MAX_PAGES);
}

/**
 * Canonical crawl key — shared with brand/product research via
 * `normalizeCrawlUrl`. Previously a local copy that stripped the hash but NOT the
 * trailing slash, so `/locations` and `/locations/` were different `seen` keys and
 * both got rendered.
 */
const normalizeUrl = normalizeCrawlUrl;

// ---------------------------------------------------------------------------
// Step 3 — scrape one page (markdown → R2, screenshot → CF Images, embed, extract)
// ---------------------------------------------------------------------------

async function scrapePage(
  env: Env,
  showroomId: number,
  ragUuid: string,
  pageUrl: string,
  /** The store's own website host — gates deterministic brand extraction. */
  siteHost?: string,
): Promise<
  PageExtraction & {
    markdown: string;
    links: Array<{ href: string; text?: string }>;
    facetBrands: FacetBrand[];
  }
> {
  const db = drizzle(env.DB);
  const scraped = await scrapeUrl(env, pageUrl);
  const markdown = scraped.markdown ?? scraped.text ?? "";
  // Keep the anchor text — extractBrandFacets needs it. (This was
  // `.map((l) => l.href)`, which threw away the brand list's labels.)
  const links = scraped.links;

  // Brands, deterministically, from THIS page's links. Done here rather than in
  // aggregate() because pattern 2 is gated on the page's own path, and the
  // aggregate flattens every page's links into one bag that loses that context.
  const facetBrands = siteHost ? extractBrandFacets(pageUrl, links, siteHost) : [];

  // (a) Screenshot → Cloudflare Images (scrapeUrl already returns a CF Images
  //     delivery URL for the snapshot; if the source is a data URL or an http
  //     URL we upload it ourselves as a fallback).
  const fullpageScreenshotCfImagesUrl = await resolveScreenshotUrl(
    env,
    scraped.screenshotUrl,
  );

  // (b) Markdown → R2.
  const r2Key = `showroom-scrapes/${ragUuid}/${encodeURIComponent(pageUrl)}.md`;
  let markdownR2Url: string | null = null;
  if (markdown.trim().length > 0) {
    try {
      await env.ARTIFACTS_BUCKET.put(r2Key, markdown, {
        httpMetadata: { contentType: "text/markdown" },
        customMetadata: { ragUuid, showroomId: String(showroomId), pageUrl },
      });
      markdownR2Url = r2Key;
    } catch (err) {
      console.error(`showroom-scrape: R2 put failed for ${pageUrl}`, err);
    }
  }

  // (c) Embed markdown into RESEARCH_INDEX (mirrors deep-sweep embed+upsert).
  await embedPage(env, { ragUuid, showroomId, pageUrl, text: markdown });

  // (d) Workers-AI structured extraction over the markdown.
  const workersAiPrompt = buildExtractionPrompt(pageUrl, markdown);
  const extraction = await extractPage(env, workersAiPrompt);

  // (e) Persist the browser_run_pages row.
  await db.insert(browserRunPages).values({
    ragUuid,
    showroomId,
    pageUrl,
    markdownR2Url,
    fullpageScreenshotCfImagesUrl,
    workersAiPrompt,
    workersAiStructuredSchema: EXTRACTION_JSON_SCHEMA as Record<string, unknown>,
    workersAiStructuredResponse: extraction as unknown as Record<
      string,
      unknown
    >,
  });

  return { ...extraction, markdown, links, facetBrands };
}

/**
 * Resolve a screenshot into a Cloudflare Images delivery URL.
 *
 * `scrapeUrl` already uploads the snapshot screenshot to CF Images and returns a
 * delivery URL, so most of the time we can pass it straight through. When the
 * value is a data URL or a raw http(s) image URL we upload it ourselves.
 */
async function resolveScreenshotUrl(
  env: Env,
  screenshotUrl: string | undefined,
): Promise<string | null> {
  if (!screenshotUrl) return null;

  // Already a CF Images delivery URL from scrapeUrl — pass through.
  if (
    screenshotUrl.startsWith("http") &&
    screenshotUrl.includes("imagedelivery.net")
  ) {
    return screenshotUrl;
  }

  const processor = await tryCreateProcessor(env);
  if (!processor) {
    // Fall back to whatever URL we have (may be an http image URL).
    return screenshotUrl.startsWith("http") ? screenshotUrl : null;
  }

  try {
    let blob: Blob | null = null;
    if (screenshotUrl.startsWith("data:")) {
      blob = dataUrlToBlob(screenshotUrl);
    } else if (screenshotUrl.startsWith("http")) {
      const resp = await fetch(screenshotUrl);
      if (resp.ok) blob = await resp.blob();
    }
    if (!blob) return screenshotUrl.startsWith("http") ? screenshotUrl : null;

    const upload = await processor.uploadToCloudflareImages(
      blob,
      undefined,
      "showroom-scrape-fullpage.png",
    );
    return processor.getDeliveryUrl(upload, upload.result.id);
  } catch (err) {
    console.error("showroom-scrape: screenshot upload failed", err);
    return screenshotUrl.startsWith("http") ? screenshotUrl : null;
  }
}

// ---------------------------------------------------------------------------
// Vectorize embedding (mirrors deep-sweep.ts embedSourceText)
// ---------------------------------------------------------------------------

async function embedPage(
  env: Env,
  params: {
    ragUuid: string;
    showroomId: number;
    pageUrl: string;
    text: string;
  },
): Promise<number> {
  const { chunks } = chunkMarkdown(params.text);
  if (chunks.length === 0) return 0;

  const hash = await stableHash(`${params.ragUuid}:${params.pageUrl}`);
  const namespace = `showroom:scrape:${params.ragUuid}`;
  let written = 0;

  // Vector ids are capped at 64 BYTES by Vectorize. The id below is
  // `${ragUuid}:${hash}:${chunkIndex}` = 36 + 1 + 16 + 1 + n = 55-58 bytes.
  //
  // It used to be `${namespace}:${hash}:${chunkIndex}`, i.e. the ragUuid PLUS a
  // 16-char "showroom:scrape:" prefix = 71 bytes, which Vectorize rejected:
  //   VECTOR_UPSERT_ERROR (code = 40008): id too long; max is 64 bytes, got 71
  // That id could never have worked — but this whole function was unreachable
  // (chunks.length === 0) for months, because scrapeUrl was handing it an empty
  // page. The first scrape that returned real text failed here, retried, and
  // re-rendered the page on every retry.
  //
  // The prefix is pure redundancy inside the id: `namespace` is already its own
  // field on the vector AND in metadata. ragUuid stays in the id, the namespace,
  // the metadata, and on the browser_run_pages row — it is the join key between
  // Vectorize and D1, so it does not get dropped to save bytes.

  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100);
    const embeddingResult = (await env.AI.run(
      EMBED_MODEL,
      { text: batch },
      { gateway: { id: env.AI_GATEWAY_ID } },
    )) as { data: number[][] };

    const vectors = embeddingResult.data.map((values, offset) => {
      const chunkIndex = i + offset;
      return {
        id: `${params.ragUuid}:${hash}:${chunkIndex}`,
        values,
        namespace,
        metadata: {
          namespace,
          ragUuid: params.ragUuid,
          showroomId: params.showroomId,
          pageUrl: params.pageUrl,
          chunkIndex,
          textPreview: batch[offset].slice(0, 240),
        } as Record<string, string | number | boolean>,
      };
    });

    await env.RESEARCH_INDEX.upsert(vectors);
    written += vectors.length;
  }

  return written;
}

async function stableHash(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (const byte of bytes.slice(0, 8)) {
    hex = `${hex}${byte.toString(16).padStart(2, "0")}`;
  }
  return hex;
}

// ---------------------------------------------------------------------------
// Workers-AI structured extraction
// ---------------------------------------------------------------------------

function buildExtractionPrompt(pageUrl: string, markdown: string): string {
  const preview =
    markdown.length > 8000 ? `${markdown.slice(0, 8000)}\n\n[truncated]` : markdown;
  return `You are extracting structured facts from a showroom / retailer website page.

Page URL: ${pageUrl}

From the page content below, extract:
- brandNames: distinct manufacturer / brand / product-line names the showroom carries (e.g. "THG Paris", "Waterworks"). Return an empty array if none are visible. Do NOT invent brands.
- instagramUrl: the showroom's Instagram profile URL, or null.
- appointmentOnly: true if the showroom is appointment-only / by-appointment, false if it accepts walk-ins, null if unclear.
- hoursText: a short human-readable opening-hours string if present, else null.
- heroImageUrl: the URL of the largest / most representative storefront or interior hero image on the page, or null.

Respond ONLY with valid JSON conforming to the supplied schema.

PAGE CONTENT:
${preview}`;
}

async function extractPage(
  env: Env,
  prompt: string,
): Promise<PageExtraction> {
  const empty: PageExtraction = {
    brandNames: [],
    instagramUrl: null,
    appointmentOnly: null,
    hoursText: null,
    heroImageUrl: null,
  };

  try {
    const raw = (await env.AI.run(
      EXTRACT_MODEL as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          {
            role: "system",
            content:
              "You are a precise structured-data extractor. Respond only with JSON.",
          },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: EXTRACTION_JSON_SCHEMA,
        },
        gateway: { id: env.AI_GATEWAY_ID },
      } as Parameters<typeof env.AI.run>[1],
    )) as { response?: unknown } & Partial<PageExtraction>;

    // `.response` is a parsed object for some models, a JSON string for others
    // (kimi via the gateway) — handle both, else a string response silently
    // yields an all-null extraction.
    const source = parseStructuredResponse<PageExtraction>(
      raw,
      "showroom page extraction",
    );

    return normalizeExtraction(source);
  } catch (err) {
    console.error("showroom-scrape: AI extraction failed", err);
    return empty;
  }
}

function normalizeExtraction(source: Partial<PageExtraction>): PageExtraction {
  const brandNames = Array.isArray(source.brandNames)
    ? source.brandNames
        .map((n) => (typeof n === "string" ? n.trim() : ""))
        .filter((n) => n.length > 0)
    : [];

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

  const bool = (v: unknown): boolean | null =>
    typeof v === "boolean" ? v : null;

  return {
    brandNames,
    instagramUrl: str(source.instagramUrl),
    appointmentOnly: bool(source.appointmentOnly),
    hoursText: str(source.hoursText),
    heroImageUrl: str(source.heroImageUrl),
  };
}

// ---------------------------------------------------------------------------
// Step 5 — aggregate (Instagram, hero image, brands)
// ---------------------------------------------------------------------------

/**
 * Hostname of a URL, or undefined when it will not parse.
 *
 * Tolerates a schemeless value ("rubensteinsupply.com"). `showroom_store_links.url`
 * is documented as "stored as entered" and the intake route validates it with
 * `z.string().min(1)` — NOT `.url()` — so a hand-typed host with no scheme is
 * reachable. `new URL("foo.com")` throws, which would return undefined here and
 * SILENTLY disable brand extraction + own-domain link classification for that
 * store. Silent degradation is the failure mode that hid the blank-scrape bug for
 * months, so it is worth the two lines. (Currently 0 of 126 prod WEBSITE links
 * are schemeless — this is defensive, not a live fix.)
 */
function safeHost(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    return new URL(withScheme).hostname;
  } catch {
    return undefined;
  }
}

async function aggregate(
  env: Env,
  showroomId: number,
  extractions: PageExtraction[],
  /** Every link the crawl saw: href for social classification, text for brands. */
  links: Array<{ href: string; text?: string }> = [],
  /** The store's website — its host gates the own-domain link matcher. */
  websiteUrl?: string,
  /** Brands recovered deterministically per-page (see brand-facets). */
  facetBrands: FacetBrand[] = [],
): Promise<void> {
  const db = drizzle(env.DB);
  const hrefs = links.map((l) => l.href);

  // ── Social profiles + own-site pages ───────────────────────────────────
  // Deterministic: classify every href the crawl saw (header/footer icons),
  // filtering out share widgets. The AI's instagramUrl is folded in as a weak
  // secondary signal — it historically missed 100% of the time, so it is never
  // the primary source.
  //
  // siteHost unlocks the own-domain classifier (WEBSITE_CLEARANCE /
  // SHOWROOM_PHOTOS); without it, only off-domain social hosts are matched.
  const siteHost = safeHost(websiteUrl);
  const social = collectSocialLinks(
    [...hrefs, ...extractions.map((e) => e.instagramUrl)],
    siteHost,
  );
  if (social.length > 0) {
    const existing = await db
      .select({
        id: showroomStoreLinks.id,
        url: showroomStoreLinks.url,
        type: showroomStoreLinks.type,
      })
      .from(showroomStoreLinks)
      .where(eq(showroomStoreLinks.storeId, showroomId))
      .all();
    // Keyed by URL, NOT by (type,url). When the vocabulary grows, a URL we
    // already stored gets re-classified — x.com used to land as OTHER and is now
    // TWITTER_X. Keying on (type,url) would miss the old row and insert a second
    // one for the same URL. Key on url and re-type in place instead.
    const byUrl = new Map(existing.map((l) => [l.url.toLowerCase(), l]));

    const inserts: Array<typeof showroomStoreLinks.$inferInsert> = [];
    const retypes: Array<{ id: number; type: (typeof social)[number]["type"]; notes: string | null }> =
      [];

    for (const s of social) {
      const prior = byUrl.get(s.url.toLowerCase());
      if (!prior) {
        inserts.push({ storeId: showroomId, url: s.url, type: s.type, urlNotes: s.urlNotes });
      } else if (prior.type !== s.type) {
        // Only ever tighten OTHER → a real type. Never clobber a type a human
        // set by hand (e.g. someone marked a page WEBSITE_CLEARANCE that our
        // path regex wouldn't catch).
        if (prior.type === "OTHER") retypes.push({ id: prior.id, type: s.type, notes: s.urlNotes });
      }
    }

    // Chunked single-row inserts: a site linking many profiles could otherwise
    // push a multi-row VALUES past D1's 100-bound-parameter cap.
    for (let i = 0; i < inserts.length; i += LINK_INSERT_CHUNK) {
      const chunk = inserts
        .slice(i, i + LINK_INSERT_CHUNK)
        .map((row) => db.insert(showroomStoreLinks).values(row));
      if (chunk.length === 0) continue;
      await db.batch(chunk as [(typeof chunk)[number], ...(typeof chunk)[number][]]);
    }
    for (let i = 0; i < retypes.length; i += LINK_INSERT_CHUNK) {
      const chunk = retypes
        .slice(i, i + LINK_INSERT_CHUNK)
        .map((r) =>
          db
            .update(showroomStoreLinks)
            .set({ type: r.type, urlNotes: r.notes, updatedAt: new Date() })
            .where(eq(showroomStoreLinks.id, r.id)),
        );
      if (chunk.length === 0) continue;
      await db.batch(chunk as [(typeof chunk)[number], ...(typeof chunk)[number][]]);
    }
  }

  // ── Hero image: first non-null heroImageUrl → fetch → CF Images. ────────
  const heroImageUrl =
    extractions.map((e) => e.heroImageUrl).find((v) => !!v) ?? null;
  if (heroImageUrl) {
    const heroCfUrl = await uploadHeroImage(env, heroImageUrl);
    if (heroCfUrl) {
      await db
        .update(showroomStores)
        .set({ heroImageCfImagesUrl: heroCfUrl, updatedAt: new Date() })
        .where(eq(showroomStores.id, showroomId));
    }
  }

  // ── Brands: union + case-insensitive dedupe across pages. ───────────────
  // The AI's per-page brandNames go in FIRST so its spelling wins the dedupe —
  // it reads "THG Paris" off the page, while a facet label may be "Thg Paris".
  // Both collapse to the same lower-case key, and first-write wins.
  const nameByLower = new Map<string, string>();
  for (const extraction of extractions) {
    for (const name of extraction.brandNames) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!nameByLower.has(key)) nameByLower.set(key, trimmed);
    }
  }

  // Then the deterministic facet/directory brands — the store's own brand list,
  // structured data we already fetched. This is where the volume is: store #132
  // yields 137 here against the AI's 6.
  const siteByLower = new Map<string, string | null>();
  for (const b of facetBrands) {
    const key = b.name.toLowerCase();
    if (!nameByLower.has(key)) nameByLower.set(key, b.name);
    // Record the website even when the AI already supplied the name.
    if (b.websiteUrl && !siteByLower.get(key)) siteByLower.set(key, b.websiteUrl);
  }

  let enrichBudget = MAX_BRAND_ENRICHMENTS_PER_SCRAPE;
  let skippedEnrichment = 0;
  for (const [key, name] of nameByLower) {
    try {
      const enriched = await upsertBrandMapping(env, showroomId, name, {
        websiteUrl: siteByLower.get(key) ?? null,
        mayEnrich: enrichBudget > 0,
      });
      if (enriched === "enriched") enrichBudget--;
      else if (enriched === "enrich-skipped") skippedEnrichment++;
    } catch (err) {
      console.error(`showroom-scrape: brand upsert failed for "${name}"`, err);
    }
  }
  if (skippedEnrichment > 0) {
    // Never silent: a truncated run must say so, or the data reads as complete.
    console.warn(
      `showroom-scrape: showroom ${showroomId} — recorded ${nameByLower.size} brands; ` +
        `enrichment budget (${MAX_BRAND_ENRICHMENTS_PER_SCRAPE}) skipped ${skippedEnrichment} ` +
        `new brand(s). They keep name + websiteUrl and can be enriched later.`,
    );
  }
}

async function uploadHeroImage(
  env: Env,
  imageUrl: string,
): Promise<string | null> {
  const processor = await tryCreateProcessor(env);
  if (!processor) return null;
  try {
    const resp = await fetch(imageUrl);
    if (!resp.ok) return null;
    const contentType = resp.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("image/")) return null;
    const blob = await resp.blob();
    const upload = await processor.uploadToCloudflareImages(
      blob,
      undefined,
      "showroom-hero.jpg",
    );
    return processor.getDeliveryUrl(upload, upload.result.id);
  } catch (err) {
    console.error("showroom-scrape: hero image upload failed", err);
    return null;
  }
}

/**
 * Insert a brand (case-insensitive match on `name`) if not present, then map it
 * to the showroom via `showroom_brand_mappings` (dup mapping ignored).
 *
 * When the brand is newly discovered (no prior row), it is enriched inline —
 * website discovery, icon hydration, online rating, price point, and a short
 * description — via `enrichNewBrand`. This runs inside a Workflow `step.do(...)`
 * body (bounded: ≤2 AI calls + ≤1 search + one icon fetch), so it is simply
 * awaited rather than fired-and-forgotten.
 */
/** What upsertBrandMapping did about enrichment — drives the caller's budget. */
type BrandUpsertOutcome = "existing" | "enriched" | "enrich-skipped";

async function upsertBrandMapping(
  env: Env,
  showroomId: number,
  name: string,
  opts: {
    /** The brand's own site, when a directory link revealed it. */
    websiteUrl?: string | null;
    /** False once the scrape's enrichment budget is spent. */
    mayEnrich?: boolean;
  } = {},
): Promise<BrandUpsertOutcome> {
  const db = drizzle(env.DB);
  const { websiteUrl = null, mayEnrich = true } = opts;

  // Case-insensitive lookup on brands.name.
  const [existing] = await db
    .select({
      id: brands.id,
      iconCfImagesUrl: brands.iconCfImagesUrl,
      websiteUrl: brands.websiteUrl,
    })
    .from(brands)
    .where(sql`lower(${brands.name}) = lower(${name})`)
    .limit(1);

  let brandId: number;
  let outcome: BrandUpsertOutcome;
  if (existing) {
    brandId = existing.id;
    outcome = "existing";
    // Backfill a website we scraped for free onto a brand that lacks one. Never
    // overwrite — an existing value may have been set by enrichment or a human.
    if (websiteUrl && !existing.websiteUrl) {
      await db.update(brands).set({ websiteUrl }).where(eq(brands.id, brandId));
    }

    // Self-heal a missing icon. `enrichNewBrand` only runs on FIRST discovery,
    // so a brand created before enrichment existed — or whose favicon fetch
    // failed that one time — would render as a lettermark box forever, which is
    // what makes the Brands & Products tile a wall of letters. Retry per scrape,
    // fill-blanks: only when the icon is still missing.
    //
    // Prefer whatever website we now know (the one just backfilled above, else
    // the stored one): hydrating from a URL is one cheap fetch. Falling back to
    // full enrichment costs AI calls, so it honours the same `mayEnrich` budget
    // as the new-brand path — a 137-brand scrape must not spend its budget
    // re-enriching brands it already has.
    const knownSite = existing.websiteUrl ?? websiteUrl;
    if (!existing.iconCfImagesUrl) {
      try {
        if (knownSite) {
          await faviconService.hydrateBrandIcon(env, brandId, knownSite);
        } else if (mayEnrich) {
          // No website anywhere — full enrichment discovers one, then hydrates.
          await enrichNewBrand(env, brandId, name);
          outcome = "enriched";
        }
      } catch (err) {
        console.error(`showroom-scrape: icon backfill failed for "${name}"`, err);
      }
    }
  } else {
    const [inserted] = await db
      .insert(brands)
      // The directory link IS the brand's website — this used to be a hard null,
      // so enrichment had to go discover what the page told us outright.
      .values({ name, websiteUrl })
      .returning({ id: brands.id });
    brandId = inserted.id;

    if (mayEnrich) {
      // Newly-discovered brand — enrich it (fill-blanks; never throws).
      try {
        await enrichNewBrand(env, brandId, name);
      } catch (err) {
        // Defensive — enrichNewBrand already never throws, but this keeps the
        // brand mapping from failing if that contract is ever violated.
        console.error(`showroom-scrape: brand enrichment failed for "${name}"`, err);
      }
      outcome = "enriched";
    } else {
      // Budget spent. The row still carries name + websiteUrl, which is most of
      // what enrichment discovers; the rest can be filled from a user-triggered
      // backfill rather than by spending here, unattended, on every scrape.
      outcome = "enrich-skipped";
    }
  }

  // Map brand → showroom, ignoring the unique-constraint duplicate.
  const [mapped] = await db
    .select({ id: showroomBrandMappings.id })
    .from(showroomBrandMappings)
    .where(
      and(
        eq(showroomBrandMappings.showroomId, showroomId),
        eq(showroomBrandMappings.brandId, brandId),
      ),
    )
    .limit(1);

  if (!mapped) {
    await db
      .insert(showroomBrandMappings)
      .values({ showroomId, brandId })
      .onConflictDoNothing();
  }

  return outcome;
}

// ---------------------------------------------------------------------------
// Step 5b — classify homeowner access level
// ---------------------------------------------------------------------------

/**
 * Classify the showroom's homeowner ACCESS LEVEL from the aggregated scraped
 * page text and persist `accessLevel`, `accessLevelReasoning`, and
 * `isTradeRepRequired` on `showroom_stores`.
 *
 * One Workers-AI structured call (llama-3.1-8b-instruct, through the AI gateway)
 * over a combined-text budget of ~{@link ACCESS_LEVEL_CHAR_BUDGET} chars,
 * prioritizing About / Visit / FAQ / Trade pages. Never throws — on any failure
 * it persists `accessLevel = "UNKNOWN"` with the flag false.
 */
async function classifyAccessLevel(
  env: Env,
  showroomId: number,
  pageTexts: ScrapedPageText[],
): Promise<void> {
  const db = drizzle(env.DB);

  const combinedText = buildAccessLevelText(pageTexts);
  const prompt = buildAccessLevelPrompt(combinedText);

  // Store the prompt used for observability/audit (no dedicated DB column).
  console.info(
    `showroom-scrape: access-level prompt for showroom ${showroomId}`,
    { prompt },
  );

  let accessLevel: AccessLevel = "UNKNOWN";
  let reasoning: string | null = null;
  let requiresTradeRep = false;

  try {
    // No usable text at all — persist UNKNOWN but still store the prompt.
    if (combinedText.trim().length > 0) {
      const raw = (await env.AI.run(
        EXTRACT_MODEL as Parameters<typeof env.AI.run>[0],
        {
          messages: [
            { role: "system", content: ACCESS_LEVEL_SYSTEM_INSTRUCTION },
            { role: "user", content: prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: ACCESS_LEVEL_SCHEMA,
          },
          gateway: { id: env.AI_GATEWAY_ID },
        } as Parameters<typeof env.AI.run>[1],
      )) as { response?: unknown } & Partial<AccessLevelResultShape>;

      const source = parseStructuredResponse<AccessLevelResultShape>(
        raw,
        "showroom access-level classification",
      );

      const parsed = AccessLevelResult.safeParse(source);
      if (parsed.success) {
        accessLevel = parsed.data.access_level;
        reasoning = parsed.data.reasoning.trim() || null;
        requiresTradeRep = parsed.data.requires_trade_rep;
        // Fallback: STRICT_TRADE_ONLY / HYBRID_ACCOMPANIED always imply a rep.
        if (TRADE_REP_IMPLIED.has(accessLevel)) {
          requiresTradeRep = true;
        }
      } else {
        console.error(
          `showroom-scrape: access-level parse failed for showroom ${showroomId}`,
          parsed.error,
        );
      }
    }
  } catch (err) {
    // Never throw out of the step — fall back to UNKNOWN / flag false.
    console.error(
      `showroom-scrape: access-level classification failed for showroom ${showroomId}`,
      err,
    );
    accessLevel = "UNKNOWN";
    reasoning = null;
    requiresTradeRep = false;
  }

  try {
    await db
      .update(showroomStores)
      .set({
        accessLevel,
        accessLevelReasoning: reasoning,
        isTradeRepRequired: requiresTradeRep,
        updatedAt: new Date(),
      })
      .where(eq(showroomStores.id, showroomId));
  } catch (err) {
    console.error(
      `showroom-scrape: failed to persist access level for showroom ${showroomId}`,
      err,
    );
  }
}

/**
 * Assemble the combined classification text from scraped page markdown,
 * prioritizing pages whose URL or markdown mentions About / Visit / FAQ / Trade,
 * capped at {@link ACCESS_LEVEL_CHAR_BUDGET} chars.
 */
function buildAccessLevelText(pageTexts: ScrapedPageText[]): string {
  const prioritized: ScrapedPageText[] = [];
  const rest: ScrapedPageText[] = [];

  for (const page of pageTexts) {
    if (!page.markdown || page.markdown.trim().length === 0) continue;
    if (
      ACCESS_PRIORITY_RE.test(page.pageUrl) ||
      ACCESS_PRIORITY_RE.test(page.markdown)
    ) {
      prioritized.push(page);
    } else {
      rest.push(page);
    }
  }

  const ordered = [...prioritized, ...rest];
  let combined = "";
  for (const page of ordered) {
    if (combined.length >= ACCESS_LEVEL_CHAR_BUDGET) break;
    const block = `# ${page.pageUrl}\n\n${page.markdown.trim()}\n\n`;
    const remaining = ACCESS_LEVEL_CHAR_BUDGET - combined.length;
    combined +=
      block.length > remaining ? `${block.slice(0, remaining)}\n[truncated]` : block;
  }

  return combined.trim();
}

/** Build the user prompt wrapping the combined scraped text. */
function buildAccessLevelPrompt(combinedText: string): string {
  return `Classify the homeowner ACCESS LEVEL of the showroom described by the scraped website text below. Follow the system instruction exactly and respond ONLY with valid JSON conforming to the supplied schema.

SCRAPED SHOWROOM TEXT:
${combinedText}`;
}

// ---------------------------------------------------------------------------
// Cloudflare Images helpers (mirrors showroom-scan.ts)
// ---------------------------------------------------------------------------

async function tryCreateProcessor(
  env: Env,
): Promise<ImageProcessorService | null> {
  try {
    const { accountId, apiTokens } =
      await resolveCloudflareImagesCredentials(env);
    const [primaryToken, ...fallbackApiTokens] = apiTokens;
    if (!accountId || !primaryToken) return null;
    return new ImageProcessorService(env, accountId, primaryToken, {
      fallbackApiTokens,
    });
  } catch {
    return null;
  }
}

/** Decode a `data:<mime>;base64,<data>` URL into a Blob. */
function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const [, mime, b64] = match;
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}
