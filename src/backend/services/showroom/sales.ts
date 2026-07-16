/**
 * @fileoverview Showroom clearance/sale tracking — extraction, change
 * detection, persistence, and RAG indexing.
 *
 * Flow (driven by the weekly cron in `_worker.ts`, and reusable ad hoc):
 *
 *   1. For each store, read its SHOWROOM_SALE / WEBSITE_CLEARANCE links.
 *   2. Scrape each page (Browser Rendering).
 *   3. Hash the extracted text. If the hash matches the newest existing row for
 *      that link, STOP — the page hasn't changed, so no row is written. This is
 *      the homeowner's "only record the sales content if the content is
 *      updated" requirement, and it's what keeps the table a history of real
 *      changes rather than a weekly cron log.
 *   4. Otherwise run a structured extraction into `ClearanceDetails`, write one
 *      `showroom_store_sales` row, and promote the link to WEBSITE_CLEARANCE
 *      when items were actually found.
 *   5. Embed the snapshot into Vectorize under a ragUuid that maps 1:1 back to
 *      the row, so /admin/shopping/sales can RAG over it.
 *
 * Everything here is guarded per-store and per-page: one dead site never aborts
 * the sweep.
 */

import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  showroomStoreLinks,
  showroomStoreSales,
  showroomStores,
  type ClearanceDetails,
  type ClearanceItem,
} from "@backend/db/schema/showroom/index";
import { scrapeUrl } from "@backend/ai/tools/browser-rendering";
import { parseStructuredResponse } from "@backend/utils/ai-json";
import { SALE_LINK_TYPES } from "@backend/utils/showroom-links";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Workers-AI embedding model — mirrors the showroom scrape + deep-sweep RAG. */
const EMBED_MODEL = "@cf/baai/bge-large-en-v1.5" as const;

/** Workers-AI instruct model for the clearance extraction. */
const EXTRACT_MODEL = "@cf/moonshotai/kimi-k2.6" as const;

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
 * Scrape + extract ONE sale page, writing a row only when the content changed.
 *
 * Returns `unchanged` when the hash matches the newest row for this link (the
 * common weekly case — most sale pages sit still), `empty` when the page
 * changed but lists nothing discounted, `recorded` when a snapshot was written.
 */
export async function sweepSalePage(
  env: Env,
  storeId: number,
  link: { id: number; url: string },
): Promise<SalePageResult> {
  const db = drizzle(env.DB);

  // Mark the ATTEMPT up front, not just a successful write. `sweepShowroomSales`
  // orders its queue by `updatedAt ASC`, so a link that is unchanged (the common
  // case) or that permanently errors must still move to the back — otherwise it
  // sits at the head of the queue and a capped run re-scans the same few pages
  // every week while the tail never gets swept. Mirrors the same
  // stampede guard in brand-enrichment.
  await db
    .update(showroomStoreLinks)
    .set({ updatedAt: new Date() })
    .where(eq(showroomStoreLinks.id, link.id));

  try {
    const scraped = await scrapeUrl(env, link.url);
    const markdown = scraped.markdown ?? scraped.text ?? "";
    if (!markdown.trim()) {
      return { linkId: link.id, url: link.url, outcome: "error", itemCount: 0, error: "empty page" };
    }

    const contentHash = await stableHash(normalizeForHash(markdown));

    // ── Change detection ──────────────────────────────────────────────────
    // Compare against the NEWEST row for this link. Unchanged → write nothing.
    const [newest] = await db
      .select({ contentHash: showroomStoreSales.contentHash })
      .from(showroomStoreSales)
      .where(eq(showroomStoreSales.clearanceWebsiteId, link.id))
      .orderBy(desc(showroomStoreSales.timestamp))
      .limit(1);

    if (newest?.contentHash === contentHash) {
      return { linkId: link.id, url: link.url, outcome: "unchanged", itemCount: 0 };
    }

    // ── Extraction ────────────────────────────────────────────────────────
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

    // Page changed but nothing is on sale. Record the snapshot anyway (with an
    // empty items[]) — that's what lets the viewport's alert CLEAR when a sale
    // ends, instead of showing last month's clearance forever.
    const items = details.items.slice(0, MAX_ITEMS_PER_SNAPSHOT);
    const ragUuid = crypto.randomUUID();

    // Supersede the previous snapshot for this link before inserting the new
    // one, so exactly one row per link is ever `isCurrent`.
    await db
      .update(showroomStoreSales)
      .set({ isCurrent: false })
      .where(
        and(
          eq(showroomStoreSales.clearanceWebsiteId, link.id),
          eq(showroomStoreSales.isCurrent, true),
        ),
      );

    await db.insert(showroomStoreSales).values({
      storeId,
      clearanceWebsiteId: link.id,
      sourceUrl: link.url,
      clearanceDetailsJson: { ...details, items },
      contentHash,
      ragUuid,
      isCurrent: true,
      timestamp: new Date(),
    });

    // Promote the link to WEBSITE_CLEARANCE once we've CONFIRMED it lists
    // discounted items — SHOWROOM_SALE is only ever a candidate.
    if (items.length > 0) {
      await db
        .update(showroomStoreLinks)
        .set({ type: "WEBSITE_CLEARANCE", updatedAt: new Date() })
        .where(eq(showroomStoreLinks.id, link.id));
    }

    // Embedding is a nice-to-have for RAG — never fail the sweep over it.
    try {
      await embedSaleSnapshot(env, { ragUuid, storeId, pageUrl: link.url, details: { ...details, items } });
    } catch (err) {
      console.error(`[showroom-sales] embed failed for link ${link.id}:`, err);
    }

    return {
      linkId: link.id,
      url: link.url,
      outcome: items.length > 0 ? "recorded" : "empty",
      itemCount: items.length,
    };
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
async function extractClearance(
  env: Env,
  pageUrl: string,
  markdown: string,
): Promise<ClearanceDetails | null> {
  try {
    const raw = (await env.AI.run(
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
        gateway: { id: env.AI_GATEWAY_ID },
      } as Parameters<typeof env.AI.run>[1],
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

  const embeddingResult = (await env.AI.run(
    EMBED_MODEL,
    { text: [text.slice(0, 4_000)] },
    { gateway: { id: env.AI_GATEWAY_ID } },
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

/**
 * Sweep every store that has at least one sale/clearance link.
 *
 * `limit` bounds pages per run so the cron can't run away on a large directory
 * — each page costs a Browser Rendering call plus an AI call. Stores are taken
 * oldest-snapshot-first so a capped run rotates through the whole corpus over
 * successive weeks rather than re-scanning the same head every time.
 */
export async function sweepShowroomSales(
  env: Env,
  opts: { limit?: number } = {},
): Promise<SalesSweepSummary> {
  const db = drizzle(env.DB);
  const limit = opts.limit ?? 40;

  const summary: SalesSweepSummary = {
    storesScanned: 0,
    pagesScanned: 0,
    recorded: 0,
    unchanged: 0,
    empty: 0,
    errors: 0,
  };

  const links = await db
    .select({
      id: showroomStoreLinks.id,
      storeId: showroomStoreLinks.storeId,
      url: showroomStoreLinks.url,
    })
    .from(showroomStoreLinks)
    .innerJoin(showroomStores, eq(showroomStoreLinks.storeId, showroomStores.id))
    .where(inArray(showroomStoreLinks.type, [...SALE_LINK_TYPES]))
    .orderBy(showroomStoreLinks.updatedAt)
    .limit(limit);

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
