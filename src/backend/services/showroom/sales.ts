/**
 * @fileoverview Showroom clearance/sale tracking — extraction, change
 * detection, persistence, and RAG indexing.
 *
 * Flow (driven by the weekly cron in `_worker.ts`, and reusable ad hoc):
 *
 *   1. For each store, read its WEBSITE_CLEARANCE links. Those are written by
 *      the scrape's own-domain path classifier (services/showroom/social-links
 *      `classifySiteLink`) — discovery is NOT this module's job.
 *   2. Scrape each page (Browser Rendering).
 *   3. Hash the extracted text. If the hash matches the newest existing row for
 *      that link, STOP — the page hasn't changed, so no row is written. This is
 *      the homeowner's "only record the sales content if the content is
 *      updated" requirement, and it's what keeps the table a history of real
 *      changes rather than a weekly cron log.
 *   4. Otherwise run a structured extraction into `ClearanceDetails` and write
 *      one `showroom_store_sales` row.
 *   5. Embed the snapshot into Vectorize under a ragUuid that maps 1:1 back to
 *      the row, so /admin/shopping/sales can RAG over it.
 *
 * Everything here is guarded per-store and per-page: one dead site never aborts
 * the sweep.
 */

import { scrapeUrl } from "@backend/ai/tools/browser-rendering";
import {
  showroomStoreLinks,
  showroomStoreSales,
  showroomStores,
  type ClearanceDetails,
  type ClearanceItem,
} from "@backend/db/schema/showroom/index";
import { meteredAiRun } from "@backend/services/usage/metered-ai";
import { parseStructuredResponse } from "@backend/utils/ai-json";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Workers-AI embedding model — mirrors the showroom scrape + deep-sweep RAG. */
const EMBED_MODEL = "@cf/baai/bge-large-en-v1.5" as const;

/**
 * Workers-AI instruct model for the FALLBACK clearance extraction (Jules is the
 * primary — see services/jules). `@cf/moonshotai/kimi-k2.7-code` — a 262k-context
 * frontier model that is more reliable on JSON-schema structured output than
 * gpt-oss-120b. It is NOT the old kimi-k2.6 (which returned empty `content` and
 * blanked snapshots — see ai/health.ts): k2.7 exposes a configurable thinking
 * mode, and we pin `thinking: false` on the extraction call (below) so it emits
 * the structured answer directly instead of into a reasoning field.
 */
const EXTRACT_MODEL = "@cf/moonshotai/kimi-k2.7-code" as const;

/** Chars of page markdown fed to the extractor. */
const EXTRACT_CHAR_BUDGET = 12_000;

/** Vectorize namespace for sale snapshots — kept separate from scrape pages. */
const SALES_NAMESPACE = "showroom:sales";

/** Hard cap on items kept per snapshot, so one giant outlet page can't blow the row up. */
const MAX_ITEMS_PER_SNAPSHOT = 60;

// ---------------------------------------------------------------------------
// Extraction schema
// ---------------------------------------------------------------------------

/**
 * Mirrors `ClearanceItem`. Every field but `title` is nullable — sale pages are
 * wildly inconsistent, and a model that must produce a price will invent one.
 */
const clearanceItemSchema = z.object({
  title: z.string(),
  brand: z.string().nullable().default(null),
  category: z.string().nullable().default(null),
  originalPrice: z.number().nullable().default(null),
  salePrice: z.number().nullable().default(null),
  discountPercent: z.number().nullable().default(null),
  dealLabel: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});

const clearanceExtractionSchema = z.object({
  items: z.array(clearanceItemSchema).default([]),
  saleHeadline: z.string().nullable().default(null),
  saleEndsText: z.string().nullable().default(null),
  summary: z.string().default(""),
});

/** JSON schema handed to Workers AI for structured output. */
const CLEARANCE_JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          brand: { type: "string" },
          category: { type: "string" },
          originalPrice: { type: "number" },
          salePrice: { type: "number" },
          discountPercent: { type: "number" },
          dealLabel: { type: "string" },
          url: { type: "string" },
          notes: { type: "string" },
        },
        required: ["title"],
      },
    },
    saleHeadline: { type: "string" },
    saleEndsText: { type: "string" },
    summary: { type: "string" },
  },
  required: ["items", "summary"],
} as const;

function buildClearancePrompt(pageUrl: string, markdown: string): string {
  const preview =
    markdown.length > EXTRACT_CHAR_BUDGET
      ? `${markdown.slice(0, EXTRACT_CHAR_BUDGET)}\n\n[truncated]`
      : markdown;

  return `You are reading a home-goods showroom's SALE / CLEARANCE page and extracting what is actually discounted.

Page URL: ${pageUrl}

Extract:
- items: one entry per DISCOUNTED product or offer actually listed on this page.
  - title: the product/offer name as printed.
  - brand: the brand, ONLY if the page names one. Otherwise null.
  - category: the category as printed ("Bath", "Tile", "Floor models"). Otherwise null.
  - originalPrice / salePrice: numbers in USD, ONLY if printed. No currency symbols. Otherwise null.
  - discountPercent: 0-100, if printed or directly computable from both prices. Otherwise null.
  - dealLabel: the discount framing as printed ("Floor model", "Final sale", "30% off"). Otherwise null.
  - url: a link to the item if the page links one. Otherwise null.
  - notes: condition, quantity, or expiry copy worth keeping. Otherwise null.
- saleHeadline: the page's headline offer ("Warehouse Sale - up to 60% off"), or null.
- saleEndsText: when the sale ends, exactly as printed ("Ends March 3"), or null.
- summary: ONE paragraph describing what is on offer. If nothing is discounted, say so plainly.

CRITICAL RULES:
- Return items ONLY for things this page actually shows as discounted/clearance.
- If the page has no active sale (e.g. "check back soon", or it is a general catalog), return an EMPTY items array and say that in the summary.
- NEVER invent a price, percent, or brand. Omit (null) whatever is not printed.

Respond ONLY with valid JSON conforming to the supplied schema.

PAGE CONTENT:
${preview}`;
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** 16-hex-char SHA-256 prefix — same helper shape as the scrape workflow. */
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

/**
 * Normalize page text before hashing so cosmetic churn doesn't read as a
 * change. Without this, a session id, a rotating "as of <timestamp>" line, or
 * reflowed whitespace would make every weekly run look like new content and the
 * change-detection would be worthless.
 */
export function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?/g, " ") // clock times
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ") // ISO dates
    .replace(/[?&](utm_[a-z]+|sid|sessionid|cb|_)=[^\s&]*/gi, " ") // cache-busters
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Per-page sweep
// ---------------------------------------------------------------------------

export interface SalePageResult {
  linkId: number;
  url: string;
  /** "unchanged" | "recorded" | "empty" | "error" */
  outcome: "unchanged" | "recorded" | "empty" | "error";
  itemCount: number;
  error?: string;
}

/**
 * Move a link to the back of the sweep queue by stamping `updatedAt`.
 *
 * `sweepShowroomSales` orders by `updatedAt ASC`, so a link that is unchanged
 * (the common case) or that permanently errors must still advance — otherwise it
 * sits at the head and a capped run re-scans the same few pages every week while
 * the tail never gets swept. Both the Workers-AI sweep and the Jules DO call this
 * up front, per page, so an ATTEMPT (not just a successful write) rotates the queue.
 */
export async function touchClearanceLink(env: Env, linkId: number): Promise<void> {
  await drizzle(env.DB)
    .update(showroomStoreLinks)
    .set({ updatedAt: new Date() })
    .where(eq(showroomStoreLinks.id, linkId));
}

/** Scrape one clearance page to normalized markdown. Empty string on a blank page. */
export async function scrapeClearanceMarkdown(env: Env, url: string): Promise<string> {
  const scraped = await scrapeUrl(env, url);
  return (scraped.markdown ?? scraped.text ?? "").trim();
}

/** Stable content hash of a page's markdown (normalized so cosmetic churn is ignored). */
export function computeClearanceHash(markdown: string): Promise<string> {
  return stableHash(normalizeForHash(markdown));
}

/** True when `contentHash` equals the newest recorded snapshot for this link. */
export async function isClearanceUnchanged(
  env: Env,
  linkId: number,
  contentHash: string,
): Promise<boolean> {
  const [newest] = await drizzle(env.DB)
    .select({ contentHash: showroomStoreSales.contentHash })
    .from(showroomStoreSales)
    .where(eq(showroomStoreSales.clearanceWebsiteId, linkId))
    .orderBy(desc(showroomStoreSales.timestamp))
    .limit(1);
  return newest?.contentHash === contentHash;
}

/**
 * Supersede the prior snapshot for this link and write the new one (+ embed).
 * Assumes the caller already confirmed the content CHANGED — extraction and the
 * change-check are the caller's job so an unchanged page never reaches here and
 * never costs a Jules/AI call. Shared by the Workers-AI sweep and the Jules DO.
 *
 * A changed page that lists nothing on sale is still recorded (empty `items[]`)
 * so the viewport's alert CLEARS when a sale ends instead of showing last month's.
 */
export async function persistSaleSnapshot(
  env: Env,
  params: {
    storeId: number;
    link: { id: number; url: string };
    contentHash: string;
    details: ClearanceDetails;
  },
): Promise<SalePageResult> {
  const db = drizzle(env.DB);
  const items = params.details.items.slice(0, MAX_ITEMS_PER_SNAPSHOT);
  const finalDetails = { ...params.details, items };
  const ragUuid = crypto.randomUUID();

  // Supersede-then-insert as ONE all-or-nothing D1 batch: no generated-id
  // dependency between them (ragUuid is JS-side), so a batch is safe and keeps
  // "exactly one isCurrent row per link" atomic. (D1 has no transactions — see
  // the CLAUDE.md D1 rule; db.batch is the sanctioned atomic unit.)
  await db.batch([
    db
      .update(showroomStoreSales)
      .set({ isCurrent: false })
      .where(
        and(
          eq(showroomStoreSales.clearanceWebsiteId, params.link.id),
          eq(showroomStoreSales.isCurrent, true),
        ),
      ),
    db.insert(showroomStoreSales).values({
      storeId: params.storeId,
      clearanceWebsiteId: params.link.id,
      sourceUrl: params.link.url,
      clearanceDetailsJson: finalDetails,
      contentHash: params.contentHash,
      ragUuid,
      isCurrent: true,
      timestamp: new Date(),
    }),
  ]);

  // Embedding is a nice-to-have for RAG — never fail the write over it.
  try {
    await embedSaleSnapshot(env, {
      ragUuid,
      storeId: params.storeId,
      pageUrl: params.link.url,
      details: finalDetails,
    });
  } catch (err) {
    console.error(`[showroom-sales] embed failed for link ${params.link.id}:`, err);
  }

  return {
    linkId: params.link.id,
    url: params.link.url,
    outcome: items.length > 0 ? "recorded" : "empty",
    itemCount: items.length,
  };
}

/**
 * Scrape + extract ONE sale page via the Workers-AI FALLBACK extractor, writing a
 * row only when the content changed. The Jules DO is the primary path; this is
 * what `sweepShowroomSales` runs when Jules is unavailable, and what the DO calls
 * per-link when a Jules batch reply can't be parsed.
 */
export async function sweepSalePage(
  env: Env,
  storeId: number,
  link: { id: number; url: string },
): Promise<SalePageResult> {
  // Mark the attempt up front so the queue rotates even on unchanged/error.
  await touchClearanceLink(env, link.id);

  try {
    const markdown = await scrapeClearanceMarkdown(env, link.url);
    if (!markdown) {
      return {
        linkId: link.id,
        url: link.url,
        outcome: "error",
        itemCount: 0,
        error: "empty page",
      };
    }

    const contentHash = await computeClearanceHash(markdown);
    if (await isClearanceUnchanged(env, link.id, contentHash)) {
      return { linkId: link.id, url: link.url, outcome: "unchanged", itemCount: 0 };
    }

    const details = await extractClearance(env, link.url, markdown);
    if (!details) {
      return {
        linkId: link.id,
        url: link.url,
        outcome: "error",
        itemCount: 0,
        error: "extraction failed",
      };
    }

    return persistSaleSnapshot(env, { storeId, link, contentHash, details });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[showroom-sales] sweep failed for ${link.url}:`, err);
    return { linkId: link.id, url: link.url, outcome: "error", itemCount: 0, error: message };
  }
}

/**
 * Run the clearance extraction over one page's markdown. Null on failure.
 *
 * Mirrors the showroom scrape's `extractPage`: `.response` comes back as a
 * parsed object from some models and a JSON *string* from others (kimi via the
 * gateway), which is what `parseStructuredResponse` normalizes. The zod parse
 * on top is what guarantees the row matches `ClearanceDetails` — a model that
 * returns a price as "$1,200" or omits `items` must not reach D1.
 */
export async function extractClearance(
  env: Env,
  pageUrl: string,
  markdown: string,
): Promise<ClearanceDetails | null> {
  try {
    // Metered: `meteredAiRun` checks the WORKERS_AI spend breaker BEFORE the call
    // (throws SpendBlockedError when over the ceiling — caught below → null, so a
    // tripped breaker halts extraction spend without blanking a snapshot) and
    // records usage after. The Browser-Rendering scrape is separately gated inside
    // `scrapeUrl`. See services/usage/metered-ai.
    const raw = (await meteredAiRun(
      env,
      EXTRACT_MODEL as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          {
            role: "system",
            content: "You are a precise structured-data extractor. Respond only with JSON.",
          },
          { role: "user", content: buildClearancePrompt(pageUrl, markdown) },
        ],
        response_format: { type: "json_schema", json_schema: CLEARANCE_JSON_SCHEMA },
        // k2.7-code is a reasoning model — DISABLE thinking so the structured
        // answer lands in `content` rather than a reasoning field (the empty-
        // content trap that broke k2.6 extraction). See ai/health.ts.
        chat_template_kwargs: { thinking: false },
        gateway: { id: env.AI_GATEWAY_ID },
      } as Parameters<typeof env.AI.run>[1],
      { feature: "clearance_extract" },
    )) as { response?: unknown } & Partial<ClearanceDetails>;

    const source = parseStructuredResponse<ClearanceDetails>(raw, "showroom clearance extraction");
    const parsed = clearanceExtractionSchema.safeParse(source);
    if (!parsed.success) {
      console.error(
        `[showroom-sales] extraction did not match schema for ${pageUrl}:`,
        parsed.error.message,
      );
      return null;
    }

    return {
      items: parsed.data.items as ClearanceItem[],
      saleHeadline: parsed.data.saleHeadline,
      saleEndsText: parsed.data.saleEndsText,
      summary: parsed.data.summary,
    };
  } catch (err) {
    console.error(`[showroom-sales] extraction failed for ${pageUrl}:`, err);
    return null;
  }
}

/**
 * Embed one sale snapshot into Vectorize, keyed so a hit maps back to the D1
 * row via `ragUuid`.
 *
 * The id is `${ragUuid}:sale` = 36 + 5 = 41 bytes. Vectorize caps ids at 64
 * BYTES and rejects longer ones with VECTOR_UPSERT_ERROR (40008) — see the
 * showroom scrape workflow, where a prefix pushed the id to 71 bytes and broke
 * every scrape. Keep any change to this id under that cap.
 */
async function embedSaleSnapshot(
  env: Env,
  params: { ragUuid: string; storeId: number; pageUrl: string; details: ClearanceDetails },
): Promise<void> {
  // One vector per snapshot: the searchable text is the summary + headline +
  // every item title/brand, which is what a homeowner would actually query
  // ("marble remnants on sale near me"), and it stays well inside one chunk.
  const itemText = params.details.items
    .map((i) => [i.brand, i.title, i.category, i.dealLabel].filter(Boolean).join(" "))
    .join("; ");
  const text = [params.details.saleHeadline, params.details.summary, itemText]
    .filter(Boolean)
    .join("\n");
  if (!text.trim()) return;

  // Metered too — the embedding is a WORKERS_AI call. A tripped breaker throws
  // here; the caller wraps embedSaleSnapshot in try/catch (embedding is
  // best-effort), so a blocked embed never fails the snapshot write.
  const embeddingResult = (await meteredAiRun(
    env,
    EMBED_MODEL,
    { text: [text.slice(0, 4_000)], gateway: { id: env.AI_GATEWAY_ID } } as Parameters<
      typeof env.AI.run
    >[1],
    { feature: "clearance_embed" },
  )) as { data: number[][] };

  const values = embeddingResult.data?.[0];
  if (!values) return;

  await env.RESEARCH_INDEX.upsert([
    {
      id: `${params.ragUuid}:sale`,
      values,
      namespace: SALES_NAMESPACE,
      metadata: {
        namespace: SALES_NAMESPACE,
        ragUuid: params.ragUuid,
        storeId: params.storeId,
        pageUrl: params.pageUrl,
        itemCount: params.details.items.length,
        textPreview: text.slice(0, 240),
      } as Record<string, string | number | boolean>,
    },
  ]);
}

// ---------------------------------------------------------------------------
// Full sweep (the weekly cron entry point)
// ---------------------------------------------------------------------------

export interface SalesSweepSummary {
  storesScanned: number;
  pagesScanned: number;
  recorded: number;
  unchanged: number;
  empty: number;
  errors: number;
}

/** One clearance page to sweep — the shared work item for both the Jules DO and the fallback sweep. */
export interface ClearanceLink {
  id: number;
  storeId: number;
  url: string;
}

/**
 * The active-store `WEBSITE_CLEARANCE` links, oldest-attempt first (so a capped
 * run rotates through the whole corpus over successive weeks). Shared by the
 * Jules DO kickoff and the Workers-AI sweep so both draw from the same queue.
 */
export async function collectClearanceLinks(env: Env, limit: number): Promise<ClearanceLink[]> {
  return drizzle(env.DB)
    .select({
      id: showroomStoreLinks.id,
      storeId: showroomStoreLinks.storeId,
      url: showroomStoreLinks.url,
    })
    .from(showroomStoreLinks)
    .innerJoin(showroomStores, eq(showroomStoreLinks.storeId, showroomStores.id))
    .where(and(eq(showroomStoreLinks.type, "WEBSITE_CLEARANCE"), eq(showroomStores.isActive, true)))
    .orderBy(showroomStoreLinks.updatedAt)
    .limit(limit);
}

/**
 * Sweep every store that has at least one sale/clearance link via the Workers-AI
 * FALLBACK extractor. The Jules DO is the primary path (see the weekly cron); this
 * runs when Jules is unavailable and remains the manual-catch-up path.
 *
 * `limit` bounds pages per run so the cron can't run away on a large directory
 * — each page costs a Browser Rendering call plus an AI call.
 */
export async function sweepShowroomSales(
  env: Env,
  opts: { limit?: number } = {},
): Promise<SalesSweepSummary> {
  const limit = opts.limit ?? 40;

  const summary: SalesSweepSummary = {
    storesScanned: 0,
    pagesScanned: 0,
    recorded: 0,
    unchanged: 0,
    empty: 0,
    errors: 0,
  };

  const links = await collectClearanceLinks(env, limit);
  if (links.length === 0) return summary;

  const storeIds = new Set<number>();
  for (const link of links) {
    storeIds.add(link.storeId);
    const result = await sweepSalePage(env, link.storeId, link);
    summary.pagesScanned++;
    if (result.outcome === "recorded") summary.recorded++;
    else if (result.outcome === "unchanged") summary.unchanged++;
    else if (result.outcome === "empty") summary.empty++;
    else summary.errors++;
  }
  summary.storesScanned = storeIds.size;

  console.info(
    `[showroom-sales] sweep complete: ${summary.pagesScanned} pages across ${summary.storesScanned} stores — ` +
      `${summary.recorded} recorded, ${summary.unchanged} unchanged, ${summary.empty} empty, ${summary.errors} errors`,
  );
  return summary;
}
