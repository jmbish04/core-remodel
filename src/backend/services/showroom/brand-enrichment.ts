/**
 * @fileoverview Brand enrichment for newly-discovered showroom brands.
 *
 * When `showroom-scrape-workflow.ts` inserts a brand row for the FIRST time
 * (case-insensitive name match found nothing), the row is name-only:
 * `{ name, websiteUrl: null }`. This service fills in the remaining
 * "healthy" brand signal so the brand is immediately useful on the showroom
 * page: website, icon (via the existing FaviconService), online rating,
 * price point, and a one-line description.
 *
 * Doctrine: FILL-BLANKS ONLY. This never overwrites a column that already
 * has a value — same discipline as the showroom bulk-backfill pipeline.
 * Every public entrypoint (`enrichNewBrand`) NEVER throws — it is called
 * directly inside a Workflow `step.do(...)` body and from a `waitUntil()`
 * backfill chain, and a thrown error would either fail an otherwise-healthy
 * workflow step or silently kill a background task with no retry.
 *
 * Website discovery order:
 *   1. Google Custom Search JSON API (`GOOGLE_SEARCH_API_KEY` + `GOOGLE_SEARCH_CX`)
 *      when both are configured — most reliable, skips marketplace/social domains.
 *   2. Workers-AI structured guess (`EXTRACT_MODEL`) as a fallback, gated behind
 *      a confidence threshold to guard against hallucinated domains.
 *
 * Rating / price point / description are ALWAYS best-effort Workers-AI
 * estimates — there is no authoritative source wired up yet, so treat them as
 * directional, not ground truth.
 */

import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import { brands } from "@backend/db/schema/brands/brands";
import { faviconService } from "@backend/services/favicon";
import { getGoogleSearchApiKey } from "@backend/utils/secrets";

/** Workers-AI instruct model used for brand website/rating/price extraction. Mirrors showroom-scrape-workflow.ts. */
const EXTRACT_MODEL = "@cf/moonshotai/kimi-k2.6" as const;

/** Domains that are never accepted as a brand's canonical website (marketplaces / social, not the brand's own site). */
const REJECTED_DOMAINS = [
  "amazon.",
  "wayfair.",
  "houzz.",
  "pinterest.",
  "instagram.",
  "facebook.",
  "ebay.",
  "walmart.",
  "target.",
  "etsy.",
  "google.",
  "yelp.",
  "wikipedia.",
  "linkedin.",
  "twitter.",
  "x.com",
  "youtube.",
  "tiktok.",
];

/** Minimum confidence (0–1) required to accept a Workers-AI-guessed website — hallucination guard. */
const WEBSITE_CONFIDENCE_THRESHOLD = 0.7;

/** Character budget for the optional page-context snippet handed to the AI calls. */
const CONTEXT_CHAR_BUDGET = 2_000;

/** Result status returned by `enrichNewBrand` — never throws, always resolves to one of these. */
export interface BrandEnrichmentResult {
  brandId: number;
  websiteFound: boolean;
  iconHydrated: boolean;
  ratingFilled: boolean;
  pricePointFilled: boolean;
  descriptionFilled: boolean;
  error: string | null;
}

/** JSON Schema for the website-discovery Workers-AI fallback call. */
const WEBSITE_GUESS_JSON_SCHEMA = {
  type: "object",
  properties: {
    websiteUrl: { type: ["string", "null"] },
    confidence: { type: "number" },
  },
  required: ["websiteUrl", "confidence"],
} as const;

interface WebsiteGuess {
  websiteUrl: string | null;
  confidence: number;
}

/** JSON Schema for the rating/price-point/description Workers-AI call. */
const BRAND_PROFILE_JSON_SCHEMA = {
  type: "object",
  properties: {
    onlineRating: { type: ["number", "null"] },
    pricePoint: { type: ["string", "null"], enum: ["$", "$$", "$$$", "$$$$", null] },
    description: { type: ["string", "null"] },
  },
  required: ["onlineRating", "pricePoint", "description"],
} as const;

interface BrandProfileGuess {
  onlineRating: number | null;
  pricePoint: string | null;
  description: string | null;
}

/** Shape of a single Google Custom Search JSON API result item we care about. */
interface CustomSearchItem {
  link?: string;
  displayLink?: string;
}

/**
 * Fills in website / icon / rating / price-point / description for a
 * newly-inserted brand row. Fill-blanks only — every DB write is scoped to
 * columns that are currently NULL. Safe to call inline inside a Workflow
 * `step.do(...)` body or from `c.executionCtx.waitUntil(...)` — never throws.
 */
export async function enrichNewBrand(
  env: Env,
  brandId: number,
  brandName: string,
  contextSnippet?: string,
): Promise<BrandEnrichmentResult> {
  const result: BrandEnrichmentResult = {
    brandId,
    websiteFound: false,
    iconHydrated: false,
    ratingFilled: false,
    pricePointFilled: false,
    descriptionFilled: false,
    error: null,
  };

  try {
    const db = drizzle(env.DB);

    const [current] = await db
      .select({
        websiteUrl: brands.websiteUrl,
        iconCfImagesUrl: brands.iconCfImagesUrl,
        onlineRating: brands.onlineRating,
        pricePoint: brands.pricePoint,
        description: brands.description,
      })
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1);

    if (!current) {
      result.error = "brand row not found";
      return result;
    }

    const snippet = contextSnippet?.trim()?.slice(0, CONTEXT_CHAR_BUDGET);
    const updates: Partial<typeof brands.$inferInsert> = {};

    // ── 1. Website discovery (fill-blanks: only if websiteUrl is NULL) ──────
    let websiteUrl: string | null = current.websiteUrl;
    if (!websiteUrl) {
      websiteUrl = await discoverBrandWebsite(env, brandName);
      if (websiteUrl) {
        updates.websiteUrl = websiteUrl;
        result.websiteFound = true;
      }
    }

    // ── 2. Rating / price point / description (fill-blanks per-column) ─────
    const needsProfile =
      current.onlineRating === null ||
      current.pricePoint === null ||
      current.description === null;

    if (needsProfile) {
      const profile = await guessBrandProfile(env, brandName, snippet);

      if (current.onlineRating === null && profile.onlineRating !== null) {
        updates.onlineRating = clampRating(profile.onlineRating);
        result.ratingFilled = true;
      }
      if (current.pricePoint === null && profile.pricePoint !== null) {
        updates.pricePoint = profile.pricePoint;
        result.pricePointFilled = true;
      }
      if (current.description === null && profile.description !== null) {
        updates.description = profile.description;
        result.descriptionFilled = true;
      }
    }

    // Consolidate into a single write. `updatedAt` is ALWAYS bumped — even
    // when nothing was enriched — to mark that an attempt was made. This
    // pairs with the backfill endpoint's `ORDER BY updatedAt ASC` so a
    // permanently-unenrichable brand is pushed to the back of the queue
    // instead of being re-selected first (and stampeded) on every run.
    updates.updatedAt = new Date();
    await db.update(brands).set(updates).where(eq(brands.id, brandId));

    // ── 3. Icon (fill-blanks: only if iconCfImagesUrl is NULL and we have a URL) ──
    if (!current.iconCfImagesUrl && websiteUrl) {
      await faviconService.hydrateBrandIcon(env, brandId, websiteUrl);
      result.iconHydrated = true;
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[brand-enrichment] enrichNewBrand failed for brand ${brandId} ("${brandName}"):`, err);
    result.error = message;
    return result;
  }
}

// ---------------------------------------------------------------------------
// Website discovery
// ---------------------------------------------------------------------------

/**
 * Resolves a brand's canonical website URL.
 *
 * Prefers Google Custom Search (skips marketplace/social domains) when both
 * `GOOGLE_SEARCH_API_KEY` and `GOOGLE_SEARCH_CX` are configured. Falls back to
 * a Workers-AI structured guess, accepted only above a confidence threshold.
 * Returns `null` (never throws) when nothing usable is found.
 */
async function discoverBrandWebsite(env: Env, brandName: string): Promise<string | null> {
  // Cast to `string`: wrangler.jsonc types this var as the literal empty
  // string (its checked-in default), but at runtime it is a plain string
  // that Justin may fill in — the literal-type narrowing isn't meaningful here.
  const cx = env.GOOGLE_SEARCH_CX as string;

  if (cx && cx.length > 0) {
    try {
      const viaSearch = await discoverViaCustomSearch(env, brandName, cx);
      if (viaSearch) return viaSearch;
    } catch (err) {
      console.warn(`[brand-enrichment] Custom Search failed for "${brandName}":`, err);
      // Fall through to the AI fallback below.
    }
  }

  return discoverViaWorkersAi(env, brandName);
}

/** Google Custom Search JSON API website discovery — skips marketplace/social domains. */
async function discoverViaCustomSearch(
  env: Env,
  brandName: string,
  cx: string,
): Promise<string | null> {
  const apiKey = await getGoogleSearchApiKey(env);
  const query = encodeURIComponent(`"${brandName}" official website`);
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${query}&num=5`;

  const resp = await fetch(url, { signal: AbortSignal.timeout(8_000) });
  if (!resp.ok) {
    console.warn(`[brand-enrichment] Custom Search returned ${resp.status} for "${brandName}"`);
    return null;
  }

  const data = (await resp.json()) as { items?: CustomSearchItem[] };
  const items = data.items ?? [];

  for (const item of items) {
    const link = item.link;
    if (!link) continue;
    let host: string;
    let origin: string;
    try {
      const u = new URL(link);
      host = u.hostname.toLowerCase();
      origin = u.origin;
    } catch {
      continue;
    }
    if (REJECTED_DOMAINS.some((rejected) => host.includes(rejected))) continue;
    // Normalize to the origin (homepage) — never store a deep link as the
    // brand's canonical website (keeps favicon hydration + display clean).
    return origin;
  }

  return null;
}

/**
 * Workers-AI fallback website guess — used when Custom Search is unconfigured
 * or comes up empty. Only accepted when the model reports confidence ≥
 * WEBSITE_CONFIDENCE_THRESHOLD, guarding against a hallucinated domain being
 * written to `brands.websiteUrl` (which would also drive a bad favicon fetch).
 */
async function discoverViaWorkersAi(env: Env, brandName: string): Promise<string | null> {
  try {
    const prompt = `What is the canonical official website domain for the manufacturer/design brand "${brandName}" (used in home-remodeling showrooms — think tile, stone, plumbing fixtures, lighting, cabinetry, appliances, etc.)?

Respond ONLY with JSON: { "websiteUrl": <the full https:// URL, or null if you are not confident>, "confidence": <0.0-1.0, your genuine confidence that this is the correct, real, currently-live domain for this exact brand> }.

If you are not highly confident, set websiteUrl to null and confidence low. Do NOT guess or invent a plausible-looking domain.`;

    const raw = (await env.AI.run(
      EXTRACT_MODEL as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          {
            role: "system",
            content: "You are a precise structured-data extractor. Respond only with JSON.",
          },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: WEBSITE_GUESS_JSON_SCHEMA,
        },
        gateway: { id: env.AI_GATEWAY_ID },
      } as Parameters<typeof env.AI.run>[1],
    )) as { response?: unknown } & Partial<WebsiteGuess>;

    const wrapped = raw?.response;
    const source =
      wrapped && typeof wrapped === "object"
        ? (wrapped as Partial<WebsiteGuess>)
        : (raw as Partial<WebsiteGuess>);

    const confidence = typeof source.confidence === "number" ? source.confidence : 0;
    const websiteUrl =
      typeof source.websiteUrl === "string" && source.websiteUrl.trim().length > 0
        ? source.websiteUrl.trim()
        : null;

    if (!websiteUrl || confidence < WEBSITE_CONFIDENCE_THRESHOLD) {
      return null;
    }

    // Validate it actually parses as a URL and isn't a rejected marketplace
    // domain, and normalize to the origin (homepage) — same discipline as the
    // Custom Search path — so we never store a deep link.
    try {
      const u = new URL(websiteUrl);
      const host = u.hostname.toLowerCase();
      if (REJECTED_DOMAINS.some((rejected) => host.includes(rejected))) return null;
      return u.origin;
    } catch {
      return null;
    }
  } catch (err) {
    console.error(`[brand-enrichment] Workers-AI website guess failed for "${brandName}":`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Rating / price point / description
// ---------------------------------------------------------------------------

/**
 * Best-effort Workers-AI estimate of a brand's public online rating,
 * relative price tier, and a one-line description. These are directional
 * estimates (no authoritative ratings source is wired up) — callers should
 * treat them as a helpful starting point, not ground truth.
 */
async function guessBrandProfile(
  env: Env,
  brandName: string,
  contextSnippet?: string,
): Promise<BrandProfileGuess> {
  const empty: BrandProfileGuess = {
    onlineRating: null,
    pricePoint: null,
    description: null,
  };

  try {
    const contextBlock = contextSnippet
      ? `\n\nAdditional context scraped from the showroom's website (may mention this brand):\n${contextSnippet}`
      : "";

    const prompt = `You are estimating public-facing profile data for the manufacturer/design brand "${brandName}" (a brand carried by a home-remodeling showroom — tile, stone, plumbing fixtures, lighting, cabinetry, appliances, etc.).${contextBlock}

Provide your best-effort estimate of:
- onlineRating: the brand's typical public review average on a 0-5 scale (based on general reputation you're aware of), or null if you have no basis for an estimate. This is a DIRECTIONAL estimate, not a live lookup — do not fabricate false precision.
- pricePoint: the brand's relative price tier — one of "$" (budget), "$$" (mid-range), "$$$" (premium), "$$$$" (luxury/ultra-premium) — or null if unknown.
- description: one concise, factual sentence describing the brand's positioning/specialty (e.g. "Italian luxury bath fixtures known for minimalist design"), or null if unknown.

Respond ONLY with valid JSON conforming to the supplied schema.`;

    const raw = (await env.AI.run(
      EXTRACT_MODEL as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          {
            role: "system",
            content: "You are a precise structured-data extractor. Respond only with JSON.",
          },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: BRAND_PROFILE_JSON_SCHEMA,
        },
        gateway: { id: env.AI_GATEWAY_ID },
      } as Parameters<typeof env.AI.run>[1],
    )) as { response?: unknown } & Partial<BrandProfileGuess>;

    const wrapped = raw?.response;
    const source =
      wrapped && typeof wrapped === "object"
        ? (wrapped as Partial<BrandProfileGuess>)
        : (raw as Partial<BrandProfileGuess>);

    return normalizeProfileGuess(source);
  } catch (err) {
    console.error(`[brand-enrichment] Workers-AI profile guess failed for "${brandName}":`, err);
    return empty;
  }
}

const VALID_PRICE_POINTS = new Set(["$", "$$", "$$$", "$$$$"]);

function normalizeProfileGuess(source: Partial<BrandProfileGuess>): BrandProfileGuess {
  const onlineRating =
    typeof source.onlineRating === "number" && !Number.isNaN(source.onlineRating)
      ? clampRating(source.onlineRating)
      : null;

  const pricePoint =
    typeof source.pricePoint === "string" && VALID_PRICE_POINTS.has(source.pricePoint)
      ? source.pricePoint
      : null;

  const description =
    typeof source.description === "string" && source.description.trim().length > 0
      ? source.description.trim()
      : null;

  return { onlineRating, pricePoint, description };
}

function clampRating(value: number): number {
  return Math.max(0, Math.min(5, value));
}
