/**
 * @fileoverview Post-create BRAND deep-research workflow.
 *
 * Whenever a brand is added (POST /api/brands, showroom scrape discovery, or
 * the ShowroomResearchAgent backfill), this Cloudflare Workflow runs the same
 * level of enrichment showrooms get:
 *
 *   1. Online-review deep research via the `@backend/ai/deep-research` engine
 *      (reviews/reputation, price tier, big-box availability, sales cadence,
 *      top product lines, social profiles) → cited markdown report.
 *   2. Workers-AI structured extraction over the report → review summary,
 *      price point, brand types, socials, big-box detail, sales intel, and
 *      the top-5 product lines.
 *   3. Website scrape (homepage + up to 3 prioritized subpages) → markdown
 *      archived to R2 (`brand-scrapes/{brandId}/…`), candidate photos, and
 *      PDF catalog links.
 *   4. Photos → Cloudflare Images → `brand_images` rows (HITL review pending).
 *   5. PDF catalogs → R2 → document center via `ingestRemoteDocument`.
 *   6. Favicon hydration (fill-blanks).
 *   7. FILL-BLANKS persistence onto `brands`, `brand_type_mappings`,
 *      `brand_product_lines`, and `brand_intel`.
 *   8. Research-report embedding into `RESEARCH_INDEX`
 *      (namespace `brand:research:{brandId}`).
 *
 * Mirrors `showroom-scrape-workflow.ts` discipline: each `step.do(...)` is
 * independently retryable; any unrecoverable failure flips
 * `brand_intel.research_status` to "failed" before re-throwing. Repeated runs
 * are safe — every persistence write is fill-blanks / conflict-ignoring.
 */

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import {
  brands,
  brandIntel,
  brandImages,
  brandProductLines,
  brandTypesDef,
  brandTypeMappings,
} from "@backend/db/schema/brands/index";
import { runDeepResearch } from "@backend/ai/deep-research";
import { scrapeUrl } from "@backend/ai/tools/browser-rendering";
import { chunkMarkdown } from "@backend/ai/agents/ResearchAgent/methods/chunk-markdown";
import { ImageProcessorService } from "@backend/services/image-processor";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";
import { faviconService } from "@backend/services/favicon";
import { ingestRemoteDocument } from "@backend/services/documents/fetch-remote";

// ---------------------------------------------------------------------------
// Params + constants
// ---------------------------------------------------------------------------

export interface BrandResearchParams {
  brandId: number;
}

/** Workers-AI embedding model — mirrors the showroom scrape RAG pipeline. */
const EMBED_MODEL = "@cf/baai/bge-large-en-v1.5" as const;

/** Workers-AI instruct model used for structured extraction. */
const EXTRACT_MODEL = "@cf/moonshotai/kimi-k2.6" as const;

/** Max prioritized subpages scraped beyond the homepage. */
const MAX_SUBPAGES = 3;

/** Max candidate photos uploaded to CF Images per run. */
const MAX_PHOTOS = 6;

/** Max PDF catalogs ingested per run. */
const MAX_CATALOGS = 5;

/** Max product lines persisted per brand. */
const MAX_PRODUCT_LINES = 5;

/** Character budget for the report+findings text handed to the extractor. */
const EXTRACT_CHAR_BUDGET = 24_000;

/** Character budget per page handed to the site-scrape extractor. */
const PAGE_EXTRACT_CHAR_BUDGET = 8_000;

/** Path fragments prioritized when picking subpages to scrape. */
const SUBPAGE_PRIORITY_RE =
  /product|collection|catalog|where-to-buy|dealer|line|series|shop/i;

/** Valid brand price tiers. */
const VALID_PRICE_POINTS = new Set(["$", "$$", "$$$", "$$$$"]);

// ---------------------------------------------------------------------------
// Structured-extraction shapes
// ---------------------------------------------------------------------------

/** Big-box availability detail — mirrors `brand_intel.bigbox_availability`. */
interface BigboxDetail {
  retailers: Array<{ name: string; url?: string | null; notes?: string | null }>;
  onlineOnly?: boolean;
  rationale: string;
}

/** Output of the "extract-structured" step over the deep-research report. */
interface BrandStructuredInsight {
  reviewSummary: string | null;
  pricePoint: string | null;
  brandTypes: string[];
  instagramUrl: string | null;
  facebookUrl: string | null;
  pinterestUrl: string | null;
  isBigboxAvailable: boolean;
  bigbox: BigboxDetail;
  salesIntel: string | null;
  productLines: Array<{
    name: string;
    description: string | null;
    productType: string | null;
    sourceUrl: string | null;
  }>;
}

/** JSON Schema constraining the report-level structured extraction. */
const BRAND_INSIGHT_JSON_SCHEMA = {
  type: "object",
  properties: {
    reviewSummary: { type: ["string", "null"] },
    pricePoint: {
      type: ["string", "null"],
      enum: ["$", "$$", "$$$", "$$$$", null],
    },
    brandTypes: { type: "array", items: { type: "string" } },
    instagramUrl: { type: ["string", "null"] },
    facebookUrl: { type: ["string", "null"] },
    pinterestUrl: { type: ["string", "null"] },
    isBigboxAvailable: { type: "boolean" },
    bigbox: {
      type: "object",
      properties: {
        retailers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              url: { type: ["string", "null"] },
              notes: { type: ["string", "null"] },
            },
            required: ["name"],
          },
        },
        onlineOnly: { type: "boolean" },
        rationale: { type: "string" },
      },
      required: ["retailers", "rationale"],
    },
    salesIntel: { type: ["string", "null"] },
    productLines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: ["string", "null"] },
          productType: { type: ["string", "null"] },
          sourceUrl: { type: ["string", "null"] },
        },
        required: ["name"],
      },
    },
  },
  required: [
    "reviewSummary",
    "brandTypes",
    "isBigboxAvailable",
    "bigbox",
    "productLines",
  ],
} as const;

/** Per-page site-scrape extraction result. */
interface PageScrapeExtraction {
  imageUrls: string[];
  pdfCatalogUrls: string[];
  instagramUrl: string | null;
  facebookUrl: string | null;
  pinterestUrl: string | null;
}

/** JSON Schema for the per-page site-scrape extraction. */
const PAGE_SCRAPE_JSON_SCHEMA = {
  type: "object",
  properties: {
    imageUrls: { type: "array", items: { type: "string" } },
    pdfCatalogUrls: { type: "array", items: { type: "string" } },
    instagramUrl: { type: ["string", "null"] },
    facebookUrl: { type: ["string", "null"] },
    pinterestUrl: { type: ["string", "null"] },
  },
  required: ["imageUrls", "pdfCatalogUrls"],
} as const;

/** Aggregate result of the "scrape-site" step. */
interface SiteScrapeResult {
  imageUrls: Array<{ url: string; pageUrl: string }>;
  pdfUrls: string[];
  socials: {
    instagramUrl: string | null;
    facebookUrl: string | null;
    pinterestUrl: string | null;
  };
}

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

export class BrandResearchWorkflow extends WorkflowEntrypoint<
  Env,
  BrandResearchParams
> {
  async run(event: WorkflowEvent<BrandResearchParams>, step: WorkflowStep) {
    const { brandId } = event.payload;
    const env = this.env;
    const db = drizzle(env.DB);

    try {
      // ── 1. mark-running — upsert the intel row + load the brand ──────────
      const brand = await step.do("mark-running", async () => {
        const [row] = await db
          .select({
            name: brands.name,
            websiteUrl: brands.websiteUrl,
            iconCfImagesUrl: brands.iconCfImagesUrl,
          })
          .from(brands)
          .where(eq(brands.id, brandId))
          .limit(1);
        if (!row) {
          throw new Error(`brand-research: brand ${brandId} not found`);
        }

        await db
          .insert(brandIntel)
          .values({ brandId, researchStatus: "running" })
          .onConflictDoUpdate({
            target: brandIntel.brandId,
            set: { researchStatus: "running", updatedAt: new Date() },
          });

        return {
          name: row.name,
          websiteUrl: row.websiteUrl,
          iconCfImagesUrl: row.iconCfImagesUrl,
        };
      });

      // ── 2. deep-research — cited multi-source report ──────────────────────
      const research = await step.do("deep-research", async () => {
        const topic = `Research the home-remodel brand "${brand.name}"${brand.websiteUrl ? ` (website: ${brand.websiteUrl})` : ``} for a San Francisco Bay Area homeowner deciding whether to buy this brand through a showroom or elsewhere. Cover: online reviews and reputation across Google, Reddit, Houzz, and trade/homeowner forums; relative price tier; whether the brand is sold at big-box retailers (Lowe's, Home Depot) or general online retailers; how often the brand runs sales, coupons, or promotions; its most notable product lines; and its official social profiles.`;
        const guidance = `Deliverables the final report MUST cover, each in its own section:
1. REVIEWS & REPUTATION — what homeowners and trade professionals actually say about "${brand.name}" on Google reviews, Reddit, Houzz, and forums; recurring praise and complaints; overall sentiment.
2. PRICE TIER — where the brand sits on a "$" (budget) to "$$$$" (luxury) scale, with evidence.
3. BIG-BOX / ONLINE AVAILABILITY — can it be bought at Lowe's, Home Depot, or mainstream online retailers (name each retailer with a URL when possible)? This is the "why pay a showroom premium?" signal — be explicit about whether showroom pricing is avoidable.
4. SALES & COUPON CADENCE — how often the brand or its retailers run sales, coupon codes, or seasonal promotions, and when.
5. TOP PRODUCT LINES — the ~5 most notable product lines / collections, one line each on what it is and why it's notable.
6. SOCIAL PROFILES — the brand's official Instagram, Facebook, and Pinterest profile URLs when they exist.
Prefer primary sources (the brand's own site, retailer listings, review platforms). Cite every claim.`;

        return runDeepResearch(env, topic, { guidance, maxIterations: 2 });
      });

      // ── 3. extract-structured — Workers-AI over the report + findings ─────
      const extracted = await step.do("extract-structured", async () =>
        extractStructuredInsight(env, brand.name, research.report, research.findings),
      );

      // ── 4. scrape-site — homepage + prioritized subpages ─────────────────
      const site = await step.do("scrape-site", async () =>
        scrapeBrandSite(env, brandId, brand.websiteUrl),
      );

      // ── 5. photos — candidate images → CF Images → brand_images ──────────
      await step.do("photos", async () =>
        uploadBrandPhotos(env, brandId, site.imageUrls),
      );

      // ── 6. catalogs — PDF catalogs → R2 → document center ────────────────
      await step.do("catalogs", async () => {
        const pdfUrls = site.pdfUrls.slice(0, MAX_CATALOGS);
        for (const url of pdfUrls) {
          const filename = pdfFilename(url);
          await ingestRemoteDocument(env, {
            url,
            title: `${brand.name} catalog — ${filename}`,
            entityType: "brand",
            entityId: String(brandId),
            docType: "SPEC",
          });
        }
        return { attempted: pdfUrls.length };
      });

      // ── 7. favicon — fill-blanks icon hydration ───────────────────────────
      await step.do("favicon", async () => {
        if (brand.websiteUrl && !brand.iconCfImagesUrl) {
          await faviconService.hydrateBrandIcon(env, brandId, brand.websiteUrl);
        }
      });

      // ── 8. persist — FILL-BLANKS writes across brand tables ──────────────
      await step.do("persist", async () =>
        persistResearch(env, brandId, extracted, site, {
          report: research.report,
          sources: research.sources,
        }),
      );

      // ── 9. embed — research report → RESEARCH_INDEX ───────────────────────
      await step.do("embed", async () =>
        embedResearchReport(env, brandId, research.report),
      );

      // ── 10. mark-complete ─────────────────────────────────────────────────
      await step.do("mark-complete", async () => {
        await db
          .update(brandIntel)
          .set({ researchStatus: "complete", updatedAt: new Date() })
          .where(eq(brandIntel.brandId, brandId));
      });
    } catch (error) {
      // Any unrecoverable failure flips status to "failed" then re-throws so
      // Workflows records the error for observability.
      try {
        await db
          .update(brandIntel)
          .set({ researchStatus: "failed", updatedAt: new Date() })
          .where(eq(brandIntel.brandId, brandId));
      } catch (markErr) {
        console.error(
          `brand-research: failed to mark brand ${brandId} failed`,
          markErr,
        );
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// Step 3 — structured extraction over the deep-research report
// ---------------------------------------------------------------------------

async function extractStructuredInsight(
  env: Env,
  brandName: string,
  report: string,
  findings: string,
): Promise<BrandStructuredInsight> {
  const empty: BrandStructuredInsight = {
    reviewSummary: null,
    pricePoint: null,
    brandTypes: [],
    instagramUrl: null,
    facebookUrl: null,
    pinterestUrl: null,
    isBigboxAvailable: false,
    bigbox: { retailers: [], rationale: "" },
    salesIntel: null,
    productLines: [],
  };

  const combined = `${report ?? ""}\n\n---\n\nRAW FINDINGS:\n${findings ?? ""}`;
  const body =
    combined.length > EXTRACT_CHAR_BUDGET
      ? `${combined.slice(0, EXTRACT_CHAR_BUDGET)}\n\n[truncated]`
      : combined;

  const prompt = `You are extracting structured facts about the home-remodel brand "${brandName}" from the deep-research report below. Extract ONLY what the report supports — do NOT invent facts.

- reviewSummary: a 2-3 sentence homeowner-facing summary of the brand's online reviews and reputation, or null.
- pricePoint: the brand's relative price tier — "$" (budget), "$$" (mid-range), "$$$" (premium), "$$$$" (luxury) — or null if unclear.
- brandTypes: coarse category labels the brand belongs to, using vocabulary like "Flooring", "Plumbing", "Hardware", "Stone & Tile", "Appliances", "Lighting", "Cabinetry", "Windows & Doors". Empty array if unknown.
- instagramUrl / facebookUrl / pinterestUrl: the brand's OFFICIAL profile URLs, or null.
- isBigboxAvailable: true when the brand can be bought at big-box retailers (Lowe's, Home Depot) or freely at mainstream online retailers.
- bigbox: { retailers: [{ name, url, notes }], onlineOnly: true when only online (not in big-box stores), rationale: one sentence on why a showroom premium is or isn't avoidable }.
- salesIntel: a short prose note on how often the brand runs sales/coupons/promotions and when, or null.
- productLines: up to ${MAX_PRODUCT_LINES} of the brand's most notable product lines, flagship first — each { name, description (one line), productType (coarse category), sourceUrl (or null) }.

Respond ONLY with valid JSON conforming to the supplied schema.

RESEARCH REPORT:
${body}`;

  try {
    const raw = (await env.AI.run(
      EXTRACT_MODEL as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          {
            role: "system",
            content: `You are a precise structured-data extractor. Respond only with JSON.`,
          },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: BRAND_INSIGHT_JSON_SCHEMA,
        },
        gateway: { id: env.AI_GATEWAY_ID },
      } as Parameters<typeof env.AI.run>[1],
    )) as { response?: unknown } & Partial<BrandStructuredInsight>;

    const wrapped = raw?.response;
    const source =
      wrapped && typeof wrapped === "object"
        ? (wrapped as Partial<BrandStructuredInsight>)
        : (raw as Partial<BrandStructuredInsight>);

    return normalizeInsight(source);
  } catch (err) {
    console.error(`brand-research: structured extraction failed for "${brandName}"`, err);
    return empty;
  }
}

/** Defensive normalization of the Workers-AI structured-extraction output. */
function normalizeInsight(
  source: Partial<BrandStructuredInsight>,
): BrandStructuredInsight {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

  const strArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .map((s) => (typeof s === "string" ? s.trim() : ""))
          .filter((s) => s.length > 0)
      : [];

  const pricePointRaw = str(source.pricePoint);
  const pricePoint =
    pricePointRaw && VALID_PRICE_POINTS.has(pricePointRaw) ? pricePointRaw : null;

  const bigboxSource =
    source.bigbox && typeof source.bigbox === "object"
      ? (source.bigbox as Partial<BigboxDetail>)
      : null;
  const retailers = Array.isArray(bigboxSource?.retailers)
    ? bigboxSource.retailers
        .filter((r): r is { name: string; url?: string | null; notes?: string | null } =>
          Boolean(r && typeof r === "object" && typeof r.name === "string" && r.name.trim()),
        )
        .map((r) => ({
          name: r.name.trim(),
          url: str(r.url),
          notes: str(r.notes),
        }))
    : [];
  const bigbox: BigboxDetail = {
    retailers,
    onlineOnly:
      typeof bigboxSource?.onlineOnly === "boolean" ? bigboxSource.onlineOnly : undefined,
    rationale: str(bigboxSource?.rationale) ?? "",
  };

  const productLines = Array.isArray(source.productLines)
    ? source.productLines
        .filter(
          (p): p is BrandStructuredInsight["productLines"][number] =>
            Boolean(p && typeof p === "object" && typeof p.name === "string" && p.name.trim()),
        )
        .slice(0, MAX_PRODUCT_LINES)
        .map((p) => ({
          name: p.name.trim(),
          description: str(p.description),
          productType: str(p.productType),
          sourceUrl: str(p.sourceUrl),
        }))
    : [];

  return {
    reviewSummary: str(source.reviewSummary),
    pricePoint,
    brandTypes: strArray(source.brandTypes),
    instagramUrl: str(source.instagramUrl),
    facebookUrl: str(source.facebookUrl),
    pinterestUrl: str(source.pinterestUrl),
    isBigboxAvailable:
      typeof source.isBigboxAvailable === "boolean" ? source.isBigboxAvailable : false,
    bigbox,
    salesIntel: str(source.salesIntel),
    productLines,
  };
}

// ---------------------------------------------------------------------------
// Step 4 — site scrape (homepage + prioritized subpages)
// ---------------------------------------------------------------------------

/**
 * Scrape the brand's homepage plus up to {@link MAX_SUBPAGES} prioritized
 * subpages (products / collections / catalog / where-to-buy). Archives each
 * page's markdown to R2 and collects candidate image URLs, PDF catalog links,
 * and social profile URLs. NEVER throws — returns an empty result on failure.
 */
async function scrapeBrandSite(
  env: Env,
  brandId: number,
  websiteUrl: string | null,
): Promise<SiteScrapeResult> {
  const result: SiteScrapeResult = {
    imageUrls: [],
    pdfUrls: [],
    socials: { instagramUrl: null, facebookUrl: null, pinterestUrl: null },
  };
  if (!websiteUrl) return result;

  try {
    let homeHost: string;
    try {
      homeHost = new URL(websiteUrl).host;
    } catch {
      return result;
    }

    const home = await scrapeUrl(env, websiteUrl);

    // ── Pick up to MAX_SUBPAGES prioritized same-domain subpages ────────────
    const seen = new Set<string>([normalizeUrl(websiteUrl) ?? websiteUrl]);
    const subpages: string[] = [];
    for (const link of home.links ?? []) {
      if (subpages.length >= MAX_SUBPAGES) break;
      const normalized = normalizeUrl(link.href, websiteUrl);
      if (!normalized || seen.has(normalized)) continue;
      let u: URL;
      try {
        u = new URL(normalized);
      } catch {
        continue;
      }
      if (u.host !== homeHost) continue;
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      seen.add(normalized);
      if (SUBPAGE_PRIORITY_RE.test(u.pathname)) {
        subpages.push(normalized);
      }
    }

    const pages: Array<{ pageUrl: string; scraped: Awaited<ReturnType<typeof scrapeUrl>> }> = [
      { pageUrl: websiteUrl, scraped: home },
    ];
    for (const pageUrl of subpages) {
      try {
        pages.push({ pageUrl, scraped: await scrapeUrl(env, pageUrl) });
      } catch (err) {
        console.error(`brand-research: subpage scrape failed for ${pageUrl}`, err);
      }
    }

    const imageSeen = new Set<string>();
    const pdfSeen = new Set<string>();

    for (const { pageUrl, scraped } of pages) {
      const markdown = scraped.markdown ?? scraped.text ?? "";

      // (a) Archive markdown to R2.
      if (markdown.trim().length > 0) {
        try {
          const r2Key = `brand-scrapes/${brandId}/${encodeURIComponent(pageUrl)}.md`;
          await env.ARTIFACTS_BUCKET.put(r2Key, markdown, {
            httpMetadata: { contentType: "text/markdown" },
            customMetadata: { brandId: String(brandId), pageUrl },
          });
        } catch (err) {
          console.error(`brand-research: R2 put failed for ${pageUrl}`, err);
        }
      }

      // (b) og:image from the raw HTML — a guaranteed-good hero candidate.
      for (const og of extractOgImages(scraped.html ?? "")) {
        const abs = normalizeUrl(og, pageUrl);
        if (abs && !imageSeen.has(abs)) {
          imageSeen.add(abs);
          result.imageUrls.push({ url: abs, pageUrl });
        }
      }

      // (c) PDF links straight from the anchor list (.pdf hrefs).
      for (const link of scraped.links ?? []) {
        const abs = normalizeUrl(link.href, pageUrl);
        if (!abs || pdfSeen.has(abs)) continue;
        if (looksLikePdfLink(abs, link.text)) {
          pdfSeen.add(abs);
          result.pdfUrls.push(abs);
        }
      }

      // (d) Workers-AI page extraction — prominent images, catalog PDFs, socials.
      const extraction = await extractPageAssets(env, pageUrl, markdown);
      for (const raw of extraction.imageUrls) {
        const abs = normalizeUrl(raw, pageUrl);
        if (abs && !imageSeen.has(abs)) {
          imageSeen.add(abs);
          result.imageUrls.push({ url: abs, pageUrl });
        }
      }
      for (const raw of extraction.pdfCatalogUrls) {
        const abs = normalizeUrl(raw, pageUrl);
        if (abs && !pdfSeen.has(abs) && looksLikePdfLink(abs)) {
          pdfSeen.add(abs);
          result.pdfUrls.push(abs);
        }
      }
      result.socials.instagramUrl ??= extraction.instagramUrl;
      result.socials.facebookUrl ??= extraction.facebookUrl;
      result.socials.pinterestUrl ??= extraction.pinterestUrl;
    }

    return result;
  } catch (err) {
    console.error(`brand-research: site scrape failed for brand ${brandId}`, err);
    return result;
  }
}

/** Extract og:image content URLs from raw HTML (both attribute orders). */
function extractOgImages(html: string): string[] {
  if (!html) return [];
  const urls: string[] = [];
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/gi,
  ];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      if (match[1]) urls.push(match[1]);
    }
  }
  return urls;
}

/** True when a link is a PDF (pathname ends .pdf) or is catalog-ish + .pdf. */
function looksLikePdfLink(href: string, text?: string): boolean {
  try {
    const pathname = new URL(href).pathname.toLowerCase();
    if (pathname.endsWith(".pdf")) return true;
    if (/catalog|brochure|lookbook|spec/i.test(`${pathname} ${text ?? ""}`) && pathname.includes(".pdf")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
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

/** Workers-AI extraction of prominent images / PDF catalogs / socials from a page. */
async function extractPageAssets(
  env: Env,
  pageUrl: string,
  markdown: string,
): Promise<PageScrapeExtraction> {
  const empty: PageScrapeExtraction = {
    imageUrls: [],
    pdfCatalogUrls: [],
    instagramUrl: null,
    facebookUrl: null,
    pinterestUrl: null,
  };
  if (!markdown || markdown.trim().length === 0) return empty;

  const preview =
    markdown.length > PAGE_EXTRACT_CHAR_BUDGET
      ? `${markdown.slice(0, PAGE_EXTRACT_CHAR_BUDGET)}\n\n[truncated]`
      : markdown;

  const prompt = `You are extracting assets from a home-remodel brand's website page.

Page URL: ${pageUrl}

From the page content below, extract:
- imageUrls: URLs of the most prominent PRODUCT or LIFESTYLE photos on the page (hero shots, collection imagery). Exclude icons, tracking pixels, and tiny UI sprites. Return an empty array if none are visible.
- pdfCatalogUrls: URLs of PDF catalogs, brochures, lookbooks, or spec sheets linked from the page.
- instagramUrl / facebookUrl / pinterestUrl: the brand's OFFICIAL social profile URLs when linked, else null.

Only return URLs that literally appear in the content. Do NOT invent URLs.

Respond ONLY with valid JSON conforming to the supplied schema.

PAGE CONTENT:
${preview}`;

  try {
    const raw = (await env.AI.run(
      EXTRACT_MODEL as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          {
            role: "system",
            content: `You are a precise structured-data extractor. Respond only with JSON.`,
          },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: PAGE_SCRAPE_JSON_SCHEMA,
        },
        gateway: { id: env.AI_GATEWAY_ID },
      } as Parameters<typeof env.AI.run>[1],
    )) as { response?: unknown } & Partial<PageScrapeExtraction>;

    const wrapped = raw?.response;
    const source =
      wrapped && typeof wrapped === "object"
        ? (wrapped as Partial<PageScrapeExtraction>)
        : (raw as Partial<PageScrapeExtraction>);

    const str = (v: unknown): string | null =>
      typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
    const strArray = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.map((s) => (typeof s === "string" ? s.trim() : "")).filter(Boolean)
        : [];

    return {
      imageUrls: strArray(source.imageUrls),
      pdfCatalogUrls: strArray(source.pdfCatalogUrls),
      instagramUrl: str(source.instagramUrl),
      facebookUrl: str(source.facebookUrl),
      pinterestUrl: str(source.pinterestUrl),
    };
  } catch (err) {
    console.error(`brand-research: page asset extraction failed for ${pageUrl}`, err);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Step 5 — photos → Cloudflare Images → brand_images
// ---------------------------------------------------------------------------

/**
 * Upload up to {@link MAX_PHOTOS} candidate images to Cloudflare Images and
 * insert `brand_images` rows (reviewStatus "pending"). Duplicate
 * (brandId, sourceUrl) pairs are skipped via the unique index +
 * onConflictDoNothing. NEVER throws — per-image failures are logged and skipped.
 */
async function uploadBrandPhotos(
  env: Env,
  brandId: number,
  candidates: Array<{ url: string; pageUrl: string }>,
): Promise<{ uploaded: number }> {
  if (candidates.length === 0) return { uploaded: 0 };

  const db = drizzle(env.DB);
  const processor = await tryCreateProcessor(env);
  if (!processor) {
    console.error(`brand-research: CF Images credentials missing for brand ${brandId}`);
    return { uploaded: 0 };
  }

  // Pre-check existing sourceUrls so we don't burn CF Images uploads on dupes.
  const existingRows = await db
    .select({ sourceUrl: brandImages.sourceUrl })
    .from(brandImages)
    .where(eq(brandImages.brandId, brandId));
  const existing = new Set(existingRows.map((r) => r.sourceUrl));

  let uploaded = 0;
  const capped = candidates.slice(0, MAX_PHOTOS);
  for (let i = 0; i < capped.length; i++) {
    const { url, pageUrl } = capped[i];
    if (existing.has(url)) continue;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) continue;
      const contentType = resp.headers.get("content-type") ?? "";
      if (!contentType.toLowerCase().startsWith("image/")) continue;
      const blob = await resp.blob();

      const customId = `brand-photo-${brandId}-${i}`;
      const upload = await processor.uploadToCloudflareImages(
        blob,
        customId,
        `brand-${brandId}-${i}.jpg`,
      );
      const deliveryUrl = processor.getDeliveryUrl(upload, upload.result.id);

      await db
        .insert(brandImages)
        .values({
          brandId,
          sourceUrl: url,
          sourcePageUrl: pageUrl,
          cfImageId: upload.result.id,
          deliveryUrl,
          imageKind: "product",
          mimeType: contentType.split(";")[0].trim() || null,
          reviewStatus: "pending",
        })
        .onConflictDoNothing();
      uploaded++;
    } catch (err) {
      console.error(
        `brand-research: photo upload failed for brand ${brandId} (${url})`,
        err,
      );
    }
  }

  return { uploaded };
}

// ---------------------------------------------------------------------------
// Step 6 helper — PDF filename for catalog titles
// ---------------------------------------------------------------------------

function pdfFilename(url: string): string {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    const last = segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]) : "";
    return last || "catalog.pdf";
  } catch {
    return "catalog.pdf";
  }
}

// ---------------------------------------------------------------------------
// Step 8 — persist (FILL-BLANKS ONLY)
// ---------------------------------------------------------------------------

/**
 * FILL-BLANKS persistence:
 *   - `brands`: pricePoint / instagramUrl / facebookUrl / pinterestUrl /
 *     description (from reviewSummary) — only when currently NULL.
 *   - `brand_type_mappings`: resolve extracted labels → brand_types_def ids
 *     (case-insensitive contains), insert missing mappings only.
 *   - `brand_product_lines`: inserted only when the brand has none yet.
 *   - `brand_intel`: reviewSummary / reviewAiInsight / isBigboxAvailable /
 *     bigboxAvailability / salesIntel / researchReport / researchSources —
 *     each only when currently NULL.
 */
async function persistResearch(
  env: Env,
  brandId: number,
  extracted: BrandStructuredInsight,
  site: SiteScrapeResult,
  research: { report: string; sources: Record<string, unknown> },
): Promise<void> {
  const db = drizzle(env.DB);

  // ── brands: fill-blanks columns ───────────────────────────────────────────
  const [current] = await db
    .select({
      pricePoint: brands.pricePoint,
      instagramUrl: brands.instagramUrl,
      facebookUrl: brands.facebookUrl,
      pinterestUrl: brands.pinterestUrl,
      description: brands.description,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!current) return;

  const instagramUrl = extracted.instagramUrl ?? site.socials.instagramUrl;
  const facebookUrl = extracted.facebookUrl ?? site.socials.facebookUrl;
  const pinterestUrl = extracted.pinterestUrl ?? site.socials.pinterestUrl;

  const brandUpdates: Partial<typeof brands.$inferInsert> = {};
  if (!current.pricePoint && extracted.pricePoint) {
    brandUpdates.pricePoint = extracted.pricePoint;
  }
  if (!current.instagramUrl && instagramUrl) brandUpdates.instagramUrl = instagramUrl;
  if (!current.facebookUrl && facebookUrl) brandUpdates.facebookUrl = facebookUrl;
  if (!current.pinterestUrl && pinterestUrl) brandUpdates.pinterestUrl = pinterestUrl;
  if (!current.description && extracted.reviewSummary) {
    brandUpdates.description = extracted.reviewSummary;
  }
  if (Object.keys(brandUpdates).length > 0) {
    brandUpdates.updatedAt = new Date();
    await db.update(brands).set(brandUpdates).where(eq(brands.id, brandId));
  }

  // ── brand_type_mappings: resolve labels → def ids, insert missing only ────
  if (extracted.brandTypes.length > 0) {
    try {
      const defs = await db
        .select({ id: brandTypesDef.id, name: brandTypesDef.name })
        .from(brandTypesDef);
      const matchedIds = new Set<number>();
      for (const label of extracted.brandTypes) {
        const needle = label.trim().toLowerCase();
        if (!needle) continue;
        for (const def of defs) {
          const defName = def.name.trim().toLowerCase();
          if (defName.includes(needle) || needle.includes(defName)) {
            matchedIds.add(def.id);
          }
        }
      }
      for (const typeId of matchedIds) {
        await db
          .insert(brandTypeMappings)
          .values({ brandId, typeId })
          .onConflictDoNothing();
      }
    } catch (err) {
      console.error(`brand-research: type mapping persist failed for brand ${brandId}`, err);
    }
  }

  // ── brand_product_lines: only when the brand has none yet ─────────────────
  if (extracted.productLines.length > 0) {
    try {
      const [existingLine] = await db
        .select({ id: brandProductLines.id })
        .from(brandProductLines)
        .where(eq(brandProductLines.brandId, brandId))
        .limit(1);
      if (!existingLine) {
        const rows = extracted.productLines
          .slice(0, MAX_PRODUCT_LINES)
          .map((line, index) => ({
            brandId,
            name: line.name,
            description: line.description,
            productType: line.productType,
            sourceUrl: line.sourceUrl,
            sortOrder: index,
          }));
        if (rows.length > 0) {
          await db.insert(brandProductLines).values(rows);
        }
      }
    } catch (err) {
      console.error(`brand-research: product-line persist failed for brand ${brandId}`, err);
    }
  }

  // ── brand_intel: fill-blanks per column ───────────────────────────────────
  const [intel] = await db
    .select()
    .from(brandIntel)
    .where(eq(brandIntel.brandId, brandId))
    .limit(1);

  const intelUpdates: Partial<typeof brandIntel.$inferInsert> = {};
  if (!intel?.reviewSummary && extracted.reviewSummary) {
    intelUpdates.reviewSummary = extracted.reviewSummary;
  }
  if (intel?.reviewAiInsight == null) {
    intelUpdates.reviewAiInsight = extracted as unknown as typeof brandIntel.$inferInsert.reviewAiInsight;
  }
  if (intel?.isBigboxAvailable == null) {
    intelUpdates.isBigboxAvailable = extracted.isBigboxAvailable;
  }
  if (intel?.bigboxAvailability == null && extracted.bigbox.rationale) {
    intelUpdates.bigboxAvailability = {
      retailers: extracted.bigbox.retailers,
      onlineOnly: extracted.bigbox.onlineOnly,
      rationale: extracted.bigbox.rationale,
    };
  }
  if (!intel?.salesIntel && extracted.salesIntel) {
    intelUpdates.salesIntel = extracted.salesIntel;
  }
  if (!intel?.researchReport && research.report) {
    intelUpdates.researchReport = research.report;
  }
  if (intel?.researchSources == null && research.sources) {
    intelUpdates.researchSources = research.sources as typeof brandIntel.$inferInsert.researchSources;
  }

  if (Object.keys(intelUpdates).length > 0) {
    intelUpdates.updatedAt = new Date();
    if (intel) {
      await db.update(brandIntel).set(intelUpdates).where(eq(brandIntel.brandId, brandId));
    } else {
      // Defensive — mark-running should have created the row already.
      await db.insert(brandIntel).values({
        brandId,
        researchStatus: "running",
        ...intelUpdates,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Step 9 — embed the research report into RESEARCH_INDEX
// ---------------------------------------------------------------------------

/**
 * Chunk + embed the deep-research report into `RESEARCH_INDEX` under the
 * namespace `brand:research:{brandId}` — mirrors the showroom scrape's
 * `embedPage` batching (100 chunks per AI/Vectorize round-trip).
 */
async function embedResearchReport(
  env: Env,
  brandId: number,
  report: string,
): Promise<number> {
  if (!report || report.trim().length === 0) return 0;

  const { chunks } = chunkMarkdown(report);
  if (chunks.length === 0) return 0;

  const namespace = `brand:research:${brandId}`;
  const hash = await stableHash(`${namespace}:${report.length}`);
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
          brandId,
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
// Cloudflare Images helper (mirrors showroom-scrape-workflow.ts)
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
