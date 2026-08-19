/**
 * @fileoverview The Jules instruction contract for clearance analysis.
 *
 * Jules is a repoless VM with a ~1M-token context, so we drive it as a batch
 * extractor: one session for the whole sweep, one `:sendMessage` per batch of
 * pages, one JSON reply per batch keyed back to our `linkId`s. This file owns
 * (1) the system prompt that pins the JSON shape, (2) the per-batch message
 * builder, and (3) the tolerant parse of Jules's reply.
 *
 * The per-item shape MIRRORS `ClearanceDetails` / `ClearanceItem` so a Jules
 * result flows into `persistSaleSnapshot` exactly like the Workers-AI fallback.
 */

import type { ClearanceDetails, ClearanceItem } from "@backend/db/schema/showroom/index";

import { z } from "zod";

/** One page's scraped content, tagged with the link it belongs to. */
export interface ClearanceBatchPage {
  linkId: number;
  url: string;
  markdown: string;
}

/** Jules's per-page result, keyed to the `linkId` we sent. */
export interface ClearanceBatchResult {
  linkId: number;
  details: ClearanceDetails;
}

/** Chars of each page's markdown we forward — Jules has room, but keep batches sane. */
const PER_PAGE_CHAR_BUDGET = 30_000;

/**
 * System prompt sent as the session's creation prompt. It establishes the role
 * and the EXACT JSON envelope every subsequent batch reply must use, so we can
 * parse replies without re-instructing the shape each time.
 */
export const CLEARANCE_SYSTEM_PROMPT = `You are a precise data-extraction worker for a home-remodel platform. You will receive BATCHES of scraped home-goods showroom SALE / CLEARANCE web pages. For each batch you must reply with ONE JSON object and NOTHING else — no prose, no markdown fences, no commentary.

Reply envelope (exact keys):
{
  "results": [
    {
      "linkId": <the integer linkId given for this page>,
      "saleHeadline": <string headline e.g. "Warehouse Sale - up to 60% off", or null>,
      "saleEndsText": <when the sale ends, exactly as printed e.g. "Ends March 3", or null>,
      "summary": <ONE paragraph describing what is on offer; if nothing is discounted, say so plainly>,
      "items": [
        {
          "title": <product/offer name as printed>,
          "brand": <brand only if the page names one, else null>,
          "category": <category as printed e.g. "Bath","Tile","Floor models", else null>,
          "originalPrice": <number USD, no symbols, only if printed, else null>,
          "salePrice": <number USD, no symbols, only if printed, else null>,
          "discountPercent": <0-100 if printed or directly computable from both prices, else null>,
          "dealLabel": <discount framing as printed e.g. "Floor model","Final sale","30% off", else null>,
          "url": <deep link to the item if the page links one, else null>,
          "notes": <condition/quantity/expiry copy worth keeping, else null>
        }
      ]
    }
  ]
}

CRITICAL RULES:
- Return one results[] entry PER page in the batch, matched by the linkId I give you.
- items[] contains ONLY things the page actually shows as discounted/clearance.
- If a page has no active sale (a general catalog, or "check back soon"), return an EMPTY items array for it and say so in its summary.
- NEVER invent a price, percent, or brand. Use null for anything not printed.
- Output ONLY the JSON object. Do not create files, do not open a pull request, do not explain your plan.`;

/** Build the per-batch user message: linkId-tagged page content + a shape reminder. */
export function buildBatchMessage(pages: ClearanceBatchPage[]): string {
  const blocks = pages
    .map((p) => {
      const md =
        p.markdown.length > PER_PAGE_CHAR_BUDGET
          ? `${p.markdown.slice(0, PER_PAGE_CHAR_BUDGET)}\n\n[truncated]`
          : p.markdown;
      return `=== PAGE linkId=${p.linkId} url=${p.url} ===\n${md}`;
    })
    .join("\n\n");

  return `Extract clearance data for the ${pages.length} page(s) below. Reply with ONLY the JSON envelope described in your instructions, one results[] entry per linkId.\n\n${blocks}`;
}

// ---------------------------------------------------------------------------
// Reply parsing
// ---------------------------------------------------------------------------

const itemSchema = z.object({
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

const resultSchema = z.object({
  linkId: z.number(),
  saleHeadline: z.string().nullable().default(null),
  saleEndsText: z.string().nullable().default(null),
  summary: z.string().default(""),
  items: z.array(itemSchema).default([]),
});

const envelopeSchema = z.object({ results: z.array(resultSchema).default([]) });

/**
 * Slice the first `{` to the last `}` before parsing — Jules is instructed to
 * return bare JSON, but a repoless agent occasionally wraps it in a sentence or
 * a ```json fence. This is the same defensive slice the grounded-Gemini path
 * uses. Returns null (never `{}`) on failure so the caller can fall back rather
 * than silently blank a snapshot.
 */
export function parseClearanceBatchReply(message: string): ClearanceBatchResult[] | null {
  const first = message.indexOf("{");
  const last = message.lastIndexOf("}");
  if (first === -1 || last <= first) return null;

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(message.slice(first, last + 1));
  } catch {
    return null;
  }

  const parsed = envelopeSchema.safeParse(parsedJson);
  if (!parsed.success) return null;

  return parsed.data.results.map((r) => ({
    linkId: r.linkId,
    details: {
      items: r.items as ClearanceItem[],
      saleHeadline: r.saleHeadline,
      saleEndsText: r.saleEndsText,
      summary: r.summary,
    },
  }));
}
