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

import {
  browserRunPages,
  showroomStores,
} from "@backend/db/schema/showroom/index";
import { brands, showroomBrandMappings } from "@backend/db/schema/brands/index";
import { scrapeUrl } from "@backend/ai/tools/browser-rendering";
import { chunkMarkdown } from "@backend/ai/agents/ResearchAgent/methods/chunk-markdown";
import { ImageProcessorService } from "@backend/services/image-processor";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";
import { faviconService } from "@backend/services/favicon";

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
const EXTRACT_MODEL = "@cf/meta/llama-3.1-8b-instruct" as const;

/** Hard cap on the number of pages crawled per run. */
const MAX_PAGES = 10;

/** Path fragments we prioritize when selecting pages to crawl. */
const PRIORITY_PATH_RE = /about|brands|lines|location|contact|hours|showroom/i;

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

      for (let i = 0; i < pageUrls.length && i < MAX_PAGES; i++) {
        const pageUrl = pageUrls[i];
        const extraction = await step.do(`scrape-${i}`, async () =>
          scrapePage(env, showroomId, ragUuid, pageUrl),
        );
        extractions.push(extraction);
      }

      // ── 4. favicon ──────────────────────────────────────────────────────
      await step.do("favicon", async () => {
        await faviconService.hydrateShowroomIcon(env, showroomId, websiteUrl);
      });

      // ── 5. aggregate ────────────────────────────────────────────────────
      await step.do("aggregate", async () =>
        aggregate(env, showroomId, extractions),
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
      // Workflows records the error for observability.
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

/** Normalize a URL against a base, stripping the hash. Returns null on junk. */
function normalizeUrl(raw: string, base?: string): string | null {
  const text = raw?.trim();
  if (!text || text.startsWith("data:") || text.startsWith("mailto:")) {
    return null;
  }
  try {
    const u = new URL(text, base);
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 3 — scrape one page (markdown → R2, screenshot → CF Images, embed, extract)
// ---------------------------------------------------------------------------

async function scrapePage(
  env: Env,
  showroomId: number,
  ragUuid: string,
  pageUrl: string,
): Promise<PageExtraction> {
  const db = drizzle(env.DB);
  const scraped = await scrapeUrl(env, pageUrl);
  const markdown = scraped.markdown ?? scraped.text ?? "";

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

  return extraction;
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
        id: `${namespace}:${hash}:${chunkIndex}`,
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

    const wrapped = raw?.response;
    const source =
      wrapped && typeof wrapped === "object"
        ? (wrapped as Partial<PageExtraction>)
        : (raw as Partial<PageExtraction>);

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

async function aggregate(
  env: Env,
  showroomId: number,
  extractions: PageExtraction[],
): Promise<void> {
  const db = drizzle(env.DB);

  // ── Instagram: first non-null, only set when currently null. ────────────
  const instagramUrl =
    extractions.map((e) => e.instagramUrl).find((v) => !!v) ?? null;
  if (instagramUrl) {
    const [current] = await db
      .select({ instagramUrl: showroomStores.instagramUrl })
      .from(showroomStores)
      .where(eq(showroomStores.id, showroomId))
      .limit(1);
    if (current && !current.instagramUrl) {
      await db
        .update(showroomStores)
        .set({ instagramUrl, updatedAt: new Date() })
        .where(eq(showroomStores.id, showroomId));
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
  const nameByLower = new Map<string, string>();
  for (const extraction of extractions) {
    for (const name of extraction.brandNames) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (!nameByLower.has(key)) nameByLower.set(key, trimmed);
    }
  }

  for (const name of nameByLower.values()) {
    try {
      await upsertBrandMapping(env, showroomId, name);
    } catch (err) {
      console.error(`showroom-scrape: brand upsert failed for "${name}"`, err);
    }
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
 */
async function upsertBrandMapping(
  env: Env,
  showroomId: number,
  name: string,
): Promise<void> {
  const db = drizzle(env.DB);

  // Case-insensitive lookup on brands.name.
  const [existing] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(sql`lower(${brands.name}) = lower(${name})`)
    .limit(1);

  let brandId: number;
  if (existing) {
    brandId = existing.id;
  } else {
    const [inserted] = await db
      .insert(brands)
      .values({ name, websiteUrl: null })
      .returning({ id: brands.id });
    brandId = inserted.id;
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
