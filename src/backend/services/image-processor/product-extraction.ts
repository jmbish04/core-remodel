// src/backend/services/image-processor/product-extraction.ts
/**
 * @fileoverview Showroom product / price-card photo extraction.
 *
 * Two-pass pipeline (mirrors the rest of image-processor): the vision model
 * (`describeImage`) reads the photo into free text, then `generateStructuredOutput`
 * (gpt-oss-120b, json_schema) turns that text into a validated `PRODUCT_EXTRACTION_SCHEMA`
 * object. Every field is nullable — the model is instructed to say what it doesn't
 * see rather than guess, and HITL review (see `mcp/tools/product_photos.ts`) is the
 * backstop for anything wrong or missing.
 */
import { z } from "zod";

import { generateStructuredOutput } from "@backend/ai/providers/index";
import { ImageProcessorService } from "./service";

/**
 * Vocabulary context injected into the extraction prompt (0020-C2) — the live
 * `categories` / `colors` / `brands` config tables, so the model reuses
 * existing definitions instead of inventing near-duplicates. See
 * `config.ts`'s GET /categories, /colors and `brands.ts`'s GET / for the
 * data these lists come from.
 */
export interface ExtractionVocabContext {
  /** Active `categories.name` values. */
  categories: string[];
  /** Active `colors` rows — reused by name when the model recognizes a match. */
  colors: { id: number; name: string; hexCode: string | null }[];
  /** `brands.name` values. */
  brands: string[];
}

export const PRODUCT_EXTRACTION_SCHEMA = z.object({
  brand: z.string().nullable().optional().catch(null).describe("Manufacturer/brand name, verbatim as printed"),
  modelNumber: z.string().nullable().optional().catch(null).describe("Model/SKU number, verbatim as printed"),
  itemName: z.string().nullable().optional().catch(null).describe("Product name/title as printed or visually described"),
  colors: z
    .array(z.object({ name: z.string(), hexCode: z.string().nullable().optional() }))
    .nullable()
    .optional()
    .catch(null)
    .describe(
      "Named colors/finishes visible or printed, each with a hex code. Reuse a provided vocabulary color's name+hex when it matches; otherwise invent a new { name, hexCode } pair per distinct color seen.",
    ),
  style: z.string().nullable().optional().catch(null).describe("Design style, e.g. 'modern', 'transitional', 'farmhouse'"),
  category: z
    .string()
    .nullable()
    .optional()
    .catch(null)
    .describe("Coarse material category this product belongs to — prefer a name from the provided category list when it matches"),
  photoKind: z
    .enum(["product", "price_card", "spec_sheet", "unknown"])
    .nullable()
    .optional()
    .catch("unknown")
    .describe("What this photo actually shows: the product itself, a price card/tag, a spec sheet, or unclear"),
  price: z.string().nullable().optional().catch(null).describe("Regular/list price, verbatim as printed (e.g. '$1,299.00')"),
  salePrice: z.string().nullable().optional().catch(null).describe("Sale/discounted price, verbatim as printed"),
  discountInfo: z.string().nullable().optional().catch(null).describe("Any discount/promo text, verbatim (e.g. '15% off', 'Save $200')"),
  dominantColors: z.array(z.string()).nullable().optional().catch(null).describe("Dominant colors visible in the photo, as hex codes"),
  confidence: z.number().int().min(0).max(100).nullable().optional().catch(null).describe("Overall confidence 0-100 in this extraction"),
});

export type ProductExtraction = z.infer<typeof PRODUCT_EXTRACTION_SCHEMA>;

const BASE_SYSTEM_PROMPT = `You are reading a photo taken inside a home-remodeling showroom. The photo is
either a product on display or a price card / tag / spec sheet sitting next to a product.

Read every visible piece of text carefully and extract:
- The brand/manufacturer name
- The model number or SKU
- The product's name/title
- Any colors or finishes named — return each as { name, hexCode }
- The design style, if apparent
- A coarse category this product belongs to
- Whether this photo is the product itself, a price card, a spec sheet, or unclear (photoKind)
- Price, sale price, and any discount text — copy these VERBATIM, exactly as printed, including
  currency symbols and punctuation. Do not compute or convert anything.
- The 3-5 most visually dominant colors in the photo as hex codes (dominantColors)

If a field is not visible or not printed, return null for it rather than guessing. Set confidence
(0-100) to reflect how certain you are overall.`;

/**
 * Appends the live vocabulary (categories/colors/brands) to the base prompt so
 * the model reuses existing definitions instead of inventing near-duplicates,
 * while still being told how to originate genuinely new "Other" values.
 */
function buildSystemPrompt(ctx?: ExtractionVocabContext): string {
  if (!ctx) return BASE_SYSTEM_PROMPT;

  const parts = [BASE_SYSTEM_PROMPT];

  if (ctx.categories.length > 0) {
    parts.push(
      `\nKnown categories: ${ctx.categories.join(", ")}.\nFor "category", use one of these names exactly when it matches what you see. If none fit, return your own short category name instead.`,
    );
  }

  if (ctx.colors.length > 0) {
    const known = ctx.colors.map((c) => `${c.name}${c.hexCode ? ` (${c.hexCode})` : ""}`).join(", ");
    parts.push(
      `\nKnown colors: ${known}.\nFor "colors", reuse a known color's exact name and hex code when what you see matches it. For any color you see that is NOT in this list, invent a new { name, hexCode } entry — one entry per distinct color (e.g. a blue-and-white product returns two entries, not one combined name).`,
    );
  }

  if (ctx.brands.length > 0) {
    parts.push(
      `\nKnown brands: ${ctx.brands.join(", ")}.\nFor "brand", use one of these names exactly when it matches what you see; otherwise return the brand name as printed/visible.`,
    );
  }

  return parts.join("\n");
}

/**
 * Structured-output pass over one or more ALREADY-COMPUTED vision descriptions.
 * Single-photo `extractShowroomProduct` below is just this called with a
 * one-element array — this is the shared extraction step.
 *
 * ponytail: multi-image support here is "describe each photo separately, then
 * do one structured-JSON pass over the concatenated descriptions" (MVP —
 * `generateStructuredOutput` only takes text, not N images at once). Upgrade
 * path if a bucket's photos disagree in practice: swap to a true multi-image
 * vision call (single describeImage-equivalent fed all N photos) once the
 * provider supports it, rather than text-concatenating N separate descriptions.
 */
export async function extractShowroomProductFromDescriptions(
  env: Env,
  visionDescriptions: string[],
  ctx?: ExtractionVocabContext,
): Promise<ProductExtraction> {
  const combined =
    visionDescriptions.length === 1
      ? visionDescriptions[0]
      : visionDescriptions.map((d, i) => `Photo ${i + 1} of ${visionDescriptions.length}:\n${d}`).join("\n\n");

  const intro =
    visionDescriptions.length === 1
      ? "Vision model's description of the showroom photo:"
      : `Vision model's descriptions of ${visionDescriptions.length} photos of the SAME product (a burst of shots taken together):`;

  return generateStructuredOutput(env, {
    messages: [
      { role: "system", content: buildSystemPrompt(ctx) },
      {
        role: "user",
        content: `${intro}\n\n${combined}\n\nExtract ONE structured product/price record that best represents this product across all the description(s) above.`,
      },
    ],
    schema: PRODUCT_EXTRACTION_SCHEMA,
    schemaName: "ShowroomProductExtraction",
  });
}

// ---------------------------------------------------------------------------
// Candidate extraction (Phase C) — 0-N candidate matches instead of one product
// ---------------------------------------------------------------------------

/** One candidate product the bucket photos MIGHT depict. Superset of the
 *  single-product fields + a match rationale. */
export const PRODUCT_CANDIDATE_SCHEMA = z.object({
  brand: z.string().nullable().optional().catch(null).describe("Manufacturer/brand name, verbatim as printed"),
  modelNumber: z.string().nullable().optional().catch(null).describe("Model/SKU number, verbatim as printed"),
  itemName: z.string().nullable().optional().catch(null).describe("Product name/title as printed or visually described"),
  colors: z
    .array(z.object({ name: z.string(), hexCode: z.string().nullable().optional() }))
    .nullable()
    .optional()
    .catch(null)
    .describe("Named colors/finishes, each { name, hexCode }"),
  style: z.string().nullable().optional().catch(null).describe("Design style, e.g. 'modern', 'transitional'"),
  category: z.string().nullable().optional().catch(null).describe("Coarse material category — prefer a provided category name when it matches"),
  price: z.string().nullable().optional().catch(null).describe("Regular/list price, verbatim as printed"),
  salePrice: z.string().nullable().optional().catch(null).describe("Sale/discounted price, verbatim"),
  discountInfo: z.string().nullable().optional().catch(null).describe("Discount/promo text, verbatim"),
  productUrl: z.string().nullable().optional().catch(null).describe("Direct product-listing URL if one is printed/visible in the photo"),
  rationale: z.string().nullable().optional().catch(null).describe("Why this is a plausible match for the photos — 1-2 sentences"),
  confidence: z.number().int().min(0).max(100).nullable().optional().catch(null).describe("Confidence 0-100 this candidate is the depicted product"),
});

export type ProductCandidate = z.infer<typeof PRODUCT_CANDIDATE_SCHEMA>;

export const PRODUCT_CANDIDATES_SCHEMA = z.object({
  candidates: z
    .array(PRODUCT_CANDIDATE_SCHEMA)
    .nullable()
    .optional()
    .catch(null)
    .describe("0-N distinct candidate products the photos might depict, most-likely first"),
});

/** Per-stack hints the grouping wizard captured (Phase A′) — narrows the model. */
export interface CandidateHints {
  brandName?: string | null;
  productName?: string | null;
  modelNumber?: string | null;
  sku?: string | null;
  productUrl?: string | null;
}

function hintsBlock(hints?: CandidateHints): string {
  if (!hints) return "";
  const lines = [
    hints.brandName && `- Brand: ${hints.brandName}`,
    hints.productName && `- Product name: ${hints.productName}`,
    hints.modelNumber && `- Model number: ${hints.modelNumber}`,
    hints.sku && `- SKU: ${hints.sku}`,
    hints.productUrl && `- Product URL: ${hints.productUrl}`,
  ].filter(Boolean);
  if (lines.length === 0) return "";
  return `\n\nThe person who took these photos supplied these hints — trust them over your own reading when they conflict:\n${lines.join("\n")}`;
}

/**
 * Candidate pass: same two-stage pipeline as `extractShowroomProductFromDescriptions`,
 * but returns 0-N candidates instead of one. Use when a bucket's photos might
 * depict more than one product, or when identity is uncertain and the human
 * should pick (HITL, Phase D/E). Returns `[]` — never throws — when the model
 * finds nothing.
 */
export async function extractShowroomProductCandidates(
  env: Env,
  visionDescriptions: string[],
  hints?: CandidateHints,
  ctx?: ExtractionVocabContext,
): Promise<ProductCandidate[]> {
  const combined =
    visionDescriptions.length === 1
      ? visionDescriptions[0]
      : visionDescriptions.map((d, i) => `Photo ${i + 1} of ${visionDescriptions.length}:\n${d}`).join("\n\n");

  const intro =
    visionDescriptions.length === 1
      ? "Vision model's description of the showroom photo:"
      : `Vision model's descriptions of ${visionDescriptions.length} photos taken together:`;

  const result = await generateStructuredOutput(env, {
    messages: [
      { role: "system", content: buildSystemPrompt(ctx) },
      {
        role: "user",
        content: `${intro}\n\n${combined}${hintsBlock(hints)}\n\nList the distinct product(s) these photo(s) might depict as candidates, most-likely first. If the photos clearly show ONE product, return one candidate. If identity is ambiguous, return each plausible match. If you cannot identify any product, return an empty candidates array.`,
      },
    ],
    schema: PRODUCT_CANDIDATES_SCHEMA,
    schemaName: "ShowroomProductCandidates",
  });

  return result.candidates ?? [];
}

/**
 * Describe the photo with the vision model, then parse that description into a
 * structured `ProductExtraction` via gpt-oss-120b json_schema output.
 *
 * `ctx`, when given, injects the live categories/colors/brands vocabulary into
 * the prompt (0020-C2) so the model reuses existing config-table definitions
 * instead of drifting into free-text near-duplicates.
 */
export async function extractShowroomProduct(
  env: Env,
  imageDataUrl: string,
  ctx?: ExtractionVocabContext,
): Promise<ProductExtraction> {
  const service = new ImageProcessorService(env, "", "");
  const visionDescription = await service.describeImage(imageDataUrl);
  return extractShowroomProductFromDescriptions(env, [visionDescription], ctx);
}
