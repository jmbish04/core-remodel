import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  productImages,
  productSpecs,
  showroomProductMappings,
  showroomStoreProducts,
  showroomStores,
  storeProductRating,
  storeProductResearch,
  storeRating,
} from "@backend/db/schema/showroom/index";
import type { ProductPromptContext } from "../types";

const DRAFT_PROMPT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as const;

function valueOrNone(value: unknown): string {
  if (value === null || value === undefined) return "none";
  const text = String(value).trim();
  return text.length > 0 ? text : "none";
}

function bulletList(items: string[]): string {
  const clean = items.map((item) => item.trim()).filter(Boolean);
  if (clean.length === 0) return "- none";

  let output = "";
  for (const item of clean) {
    output = `${output}- ${item}
`;
  }
  return output.trimEnd();
}

function findingList(
  findings: ProductPromptContext["researchFindings"],
): string {
  if (findings.length === 0) return "- none";

  let output = "";
  for (const finding of findings) {
    output = `${output}- [${valueOrNone(finding.sentiment)}] ${finding.finding} (${valueOrNone(finding.findingUrl)})
`;
  }
  return output.trimEnd();
}

function specList(specs: ProductPromptContext["specs"]): string {
  if (specs.length === 0) return "- none";

  let output = "";
  for (const spec of specs) {
    output = `${output}- ${spec.specKey}: ${spec.specValue}${spec.unit ? ` ${spec.unit}` : ""} (${valueOrNone(spec.sourceUrl)})
`;
  }
  return output.trimEnd();
}

function imageList(images: ProductPromptContext["images"]): string {
  if (images.length === 0) return "- none";

  let output = "";
  for (const image of images) {
    output = `${output}- ${image.imageKind}: ${image.deliveryUrl} from ${image.sourceUrl}; alt=${valueOrNone(image.altText)}
`;
  }
  return output.trimEnd();
}

function ratingList(
  ratings: Array<{ rating: number; ratingNotes: string | null }>,
): string {
  if (ratings.length === 0) return "- none";

  let output = "";
  for (const rating of ratings) {
    output = `${output}- ${rating.rating}/5: ${valueOrNone(rating.ratingNotes)}
`;
  }
  return output.trimEnd();
}

function extractNegativeConstraints(
  productRatings: Array<{ rating: number; ratingNotes: string | null }>,
  storeRatings: Array<{ rating: number; ratingNotes: string | null }>,
): string[] {
  const constraints: string[] = [];
  for (const rating of productRatings) {
    if (rating.rating <= 1 && rating.ratingNotes?.trim()) {
      constraints.push(`Avoid product recommendations that repeat this rejection: ${rating.ratingNotes.trim()}`);
    }
  }
  for (const rating of storeRatings) {
    if (rating.rating <= 1 && rating.ratingNotes?.trim()) {
      constraints.push(`Avoid showroom recommendations that repeat this rejection: ${rating.ratingNotes.trim()}`);
    }
  }
  return constraints;
}

/**
 * Turn homeowner-rejected findings into negative constraints so the next sweep
 * learns from the corrections. A finding is typically rejected because Workers
 * AI mis-attributed it to the wrong entity or it was low-quality; we replay the
 * finding text plus any reason the homeowner gave.
 */
function rejectedFindingConstraints(
  findings: Array<{ finding: string; reviewStatus: string; reviewReason: string | null }>,
): string[] {
  const constraints: string[] = [];
  for (const f of findings) {
    if (f.reviewStatus !== "rejected") continue;
    const reason = f.reviewReason?.trim();
    constraints.push(
      reason
        ? `Do not repeat this previously rejected finding (${reason}): ${f.finding.trim()}`
        : `Do not repeat this previously rejected finding: ${f.finding.trim()}`,
    );
  }
  return constraints;
}

export async function loadProductPromptContext(
  env: Env,
  productId: number,
  extraNegativeConstraints: string[] = [],
): Promise<ProductPromptContext> {
  const db = drizzle(env.DB);
  const [product] = await db
    .select()
    .from(showroomStoreProducts)
    .where(eq(showroomStoreProducts.id, productId))
    .limit(1);

  if (!product) {
    throw new Error(`Showroom product ${productId} not found`);
  }

  // A product has no owning store — it is global. Resolve one representative
  // showroom (if any) that carries it via showroom_product_mappings, purely
  // to ground the research prompt with store context when available.
  const [store] = await db
    .select({ store: showroomStores })
    .from(showroomProductMappings)
    .innerJoin(showroomStores, eq(showroomProductMappings.showroomId, showroomStores.id))
    .where(eq(showroomProductMappings.productId, productId))
    .limit(1)
    .then((rows) => rows.map((r) => r.store));

  const [
    activeProductRatings,
    activeStoreRatings,
    researchFindings,
    specs,
    images,
  ] = await Promise.all([
    db
      .select({
        rating: storeProductRating.rating,
        ratingNotes: storeProductRating.ratingNotes,
      })
      .from(storeProductRating)
      .where(
        and(
          eq(storeProductRating.storeProductId, productId),
          eq(storeProductRating.isActive, true),
        ),
      )
      .orderBy(desc(storeProductRating.createdAt)),
    store
      ? db
          .select({
            rating: storeRating.rating,
            ratingNotes: storeRating.ratingNotes,
          })
          .from(storeRating)
          .where(
            and(
              eq(storeRating.storeId, store.id),
              eq(storeRating.isActive, true),
            ),
          )
          .orderBy(desc(storeRating.createdAt))
      : Promise.resolve([]),
    db
      .select({
        finding: storeProductResearch.finding,
        findingUrl: storeProductResearch.findingUrl,
        sentiment: storeProductResearch.sentiment,
        reviewStatus: storeProductResearch.reviewStatus,
        reviewReason: storeProductResearch.reviewReason,
      })
      .from(storeProductResearch)
      .where(eq(storeProductResearch.storeProductId, productId))
      .orderBy(desc(storeProductResearch.timestamp))
      .limit(20),
    db
      .select({
        specKey: productSpecs.specKey,
        specValue: productSpecs.specValue,
        unit: productSpecs.unit,
        sourceUrl: productSpecs.sourceUrl,
      })
      .from(productSpecs)
      .where(eq(productSpecs.storeProductId, productId))
      .orderBy(desc(productSpecs.updatedAt))
      .limit(40),
    db
      .select({
        deliveryUrl: productImages.deliveryUrl,
        sourceUrl: productImages.sourceUrl,
        imageKind: productImages.imageKind,
        altText: productImages.altText,
      })
      .from(productImages)
      .where(eq(productImages.storeProductId, productId))
      .orderBy(desc(productImages.updatedAt))
      .limit(20),
  ]);

  const negativeConstraints = [
    ...extractNegativeConstraints(activeProductRatings, activeStoreRatings),
    ...rejectedFindingConstraints(researchFindings),
    ...extraNegativeConstraints.map((value) => value.trim()).filter(Boolean),
  ];

  return {
    product: {
      id: product.id,
      itemName: product.itemName,
      description: product.description,
      colors: product.colors,
      preferredColor: product.preferredColor,
      sku: product.sku,
      price: product.price,
      jsonDetails: product.jsonDetails,
      notes: product.notes,
      leadTime: product.leadTime,
      possibleDiscounts: product.possibleDiscounts,
      tradeDiscount: product.tradeDiscount,
    },
    store: store
      ? {
          id: store.id,
          name: store.name,
          description: store.description,
          websiteUrl: store.websiteUrl,
          locationAddress: store.locationAddress,
          inventoryFocus: store.inventoryFocus,
          targetDemographic: store.targetDemographic,
          pricePoint: store.pricePoint,
        }
      : null,
    activeProductRatings,
    activeStoreRatings,
    researchFindings,
    specs,
    images,
    negativeConstraints,
  };
}

export function buildProductResearchPrompt(context: ProductPromptContext): string {
  return `Research prompt for showroom product sourcing.

Target product:
- ID: ${context.product.id}
- Name: ${context.product.itemName}
- SKU: ${valueOrNone(context.product.sku)}
- Price: ${valueOrNone(context.product.price)}
- Description: ${valueOrNone(context.product.description)}
- Colors: ${valueOrNone(context.product.colors)}
- Preferred color: ${valueOrNone(context.product.preferredColor)}
- Lead time: ${valueOrNone(context.product.leadTime)}
- Discounts: ${valueOrNone(context.product.possibleDiscounts)}
- Trade discount: ${valueOrNone(context.product.tradeDiscount)}
- JSON details: ${valueOrNone(context.product.jsonDetails)}
- Notes: ${valueOrNone(context.product.notes)}

Store context:
- Store ID: ${valueOrNone(context.store?.id)}
- Name: ${valueOrNone(context.store?.name)}
- Website: ${valueOrNone(context.store?.websiteUrl)}
- Address: ${valueOrNone(context.store?.locationAddress)}
- Description: ${valueOrNone(context.store?.description)}
- Inventory focus: ${valueOrNone(context.store?.inventoryFocus)}
- Target demographic: ${valueOrNone(context.store?.targetDemographic)}
- Price point: ${valueOrNone(context.store?.pricePoint)}

Existing product ratings:
${ratingList(context.activeProductRatings)}

Existing store ratings:
${ratingList(context.activeStoreRatings)}

Known research findings:
${findingList(context.researchFindings)}

Known specifications:
${specList(context.specs)}

Known product images:
${imageList(context.images)}

Negative constraints from homeowner feedback:
${bulletList(context.negativeConstraints)}

Write a source-seeking deep research prompt that is specific to this product and store. The prompt must ask for:
- official manufacturer/product pages
- warranty documents and installation requirements
- high-resolution semantic product images
- review sources and quality concerns
- compatibility risks for a high-end San Francisco remodel
- source URLs suitable for Browser Rendering extraction

Return only the prompt text.`;
}

export async function generateProductDraftPrompt(
  env: Env,
  productId: number,
  extraNegativeConstraints: string[] = [],
): Promise<string> {
  const context = await loadProductPromptContext(env, productId, extraNegativeConstraints);
  const userPrompt = buildProductResearchPrompt(context);

  const response = (await env.AI.run(
    DRAFT_PROMPT_MODEL,
    {
      messages: [
        {
          role: "system",
          content: `You are a sourcing research prompt architect for a remodel planning system.
Generate a precise, asset-specific prompt that a deep research agent can use to find cited product evidence.
Return raw prompt text only. Do not include markdown fences.`,
        },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 1200,
    } as any,
    { gateway: { id: env.AI_GATEWAY_ID } },
  )) as string | { response?: string; text?: string };

  const text =
    typeof response === "string"
      ? response
      : response.response ?? response.text ?? "";

  return text.trim() || userPrompt;
}
