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

/** Coarse material category used to group products across brands. */
export const PRODUCT_CATEGORY_VALUES = [
  "stone",
  "plumbing",
  "cabinet",
  "flooring",
  "lighting",
  "tile",
  "other",
] as const;

export const PRODUCT_EXTRACTION_SCHEMA = z.object({
  brand: z.string().nullable().optional().catch(null).describe("Manufacturer/brand name, verbatim as printed"),
  modelNumber: z.string().nullable().optional().catch(null).describe("Model/SKU number, verbatim as printed"),
  itemName: z.string().nullable().optional().catch(null).describe("Product name/title as printed or visually described"),
  colors: z.array(z.string()).nullable().optional().catch(null).describe("Named colors/finishes visible or printed (e.g. 'Brushed Nickel')"),
  style: z.string().nullable().optional().catch(null).describe("Design style, e.g. 'modern', 'transitional', 'farmhouse'"),
  category: z
    .enum(PRODUCT_CATEGORY_VALUES)
    .nullable()
    .optional()
    .catch(null)
    .describe("Coarse material category this product belongs to"),
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

const SYSTEM_PROMPT = `You are reading a photo taken inside a home-remodeling showroom. The photo is
either a product on display or a price card / tag / spec sheet sitting next to a product.

Read every visible piece of text carefully and extract:
- The brand/manufacturer name
- The model number or SKU
- The product's name/title
- Any colors or finishes named
- The design style, if apparent
- A coarse category: stone, plumbing, cabinet, flooring, lighting, tile, or other
- Whether this photo is the product itself, a price card, a spec sheet, or unclear (photoKind)
- Price, sale price, and any discount text — copy these VERBATIM, exactly as printed, including
  currency symbols and punctuation. Do not compute or convert anything.
- The 3-5 most visually dominant colors in the photo as hex codes

If a field is not visible or not printed, return null for it rather than guessing. Set confidence
(0-100) to reflect how certain you are overall.`;

/**
 * Describe the photo with the vision model, then parse that description into a
 * structured `ProductExtraction` via gpt-oss-120b json_schema output.
 */
export async function extractShowroomProduct(
  env: Env,
  imageDataUrl: string,
): Promise<ProductExtraction> {
  const service = new ImageProcessorService(env, "", "");
  const visionDescription = await service.describeImage(imageDataUrl);

  return generateStructuredOutput(env, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Vision model's description of the showroom photo:\n\n${visionDescription}\n\nExtract the structured product/price fields from this description.`,
      },
    ],
    schema: PRODUCT_EXTRACTION_SCHEMA,
    schemaName: "ShowroomProductExtraction",
  });
}
