/**
 * @fileoverview Server-side showroom category inference + persistence.
 *
 * Maps Google Places `types` / `primaryType` tokens (plus any AI-insight brand
 * type strings, e.g. "Hardwood Flooring", "Tile") onto the internal showroom
 * category vocabulary seeded in `seed-reference-data.sql`, then writes
 * `showroom_store_category_mapping` rows — FILL-BLANKS ONLY (a store that
 * already has any category mapping is left untouched).
 *
 * The rule table mirrors `CATEGORY_RULES` in
 * `src/frontend/components/showroom/intake/places-mapper.ts` (the single-add
 * intake uses the frontend copy to pre-select the category multi-select).
 * KEEP THE TWO IN SYNC when the vocabulary evolves.
 */

import {
  showroomStores,
  showroomStoreCategory,
  showroomStoreCategoryMapping,
} from "@backend/db/schema/showroom/index";
import { createGeminiAiGatewayClient } from "@backend/services/render/providers/gemini-stage-provider";
import { stripJsonFence } from "@backend/utils/ai-json";
import { Type } from "@google/genai";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

/**
 * The rule table and the pure classifier now live in `showroom-category-rules.ts`
 * and are re-exported here so existing importers are unchanged.
 *
 * WHY THEY MOVED. The table emitted labels from an OLDER vocabulary and was never
 * updated when the live one changed. Measured against the live 28-row
 * `showroom_store_category` on 2026-07-16: 15 of 19 emitted labels resolved to
 * NOTHING, and the 4 that did resolve were WRONG — the single rule
 * `/tile|stone|flooring/` emitted "Flooring", which the fuzzy branch of
 * `pushMatch` bound to "Hardwood & Flooring Specialists", filing every tile shop
 * and stone yard in the directory as a hardwood flooring specialist.
 *
 * That is why 86 of 146 stores carried zero categories.
 *
 * The rules now emit `CanonicalCategory` — the exact live names — so a stale
 * label is a COMPILE ERROR rather than a silently dead rule, and the regex path
 * below can be matched exactly like the AI path. Splitting them into a
 * dependency-free module also lets `pnpm run test:cats` exercise them with plain
 * node (this file imports drizzle, which bare node cannot resolve via @backend).
 */
export {
  CANONICAL_CATEGORIES,
  type CanonicalCategory,
  inferCategoryLabelsFromTokens,
} from "./showroom-category-rules";
import { inferCategoryLabelsFromTokens } from "./showroom-category-rules";


/**
 * AI classifier: pick the applicable categories for a showroom STRICTLY from the
 * live vocabulary, using the store's own context (name, description, review
 * summary, stocked brands, Google place types). This is the real "AI
 * categorization" — the regex rules above only fire on specific Google `types`
 * tokens (e.g. `lighting_store`), which most showrooms don't carry, so on their
 * own they leave nearly every store blank. Returns exact vocabulary names,
 * relevance-ordered (most central first). Best-effort: returns [] on any error.
 */
/**
 * Ask Gemini which categories a showroom belongs to.
 *
 * RETURNS PRIMARY KEYS, NOT NAMES. The model is handed each category's `id`,
 * `name` AND `description` and returns `categoryIds`. The previous version sent
 * names only and matched the reply back with a case-sensitive string compare —
 * one stray character ("Lighting Showroom" vs "Lighting Showrooms") silently
 * dropped the category, which is the same class of failure that left 86 of 146
 * stores uncategorised. An integer either is a real key or it isn't.
 *
 * Descriptions matter as much as ids: "Slab & Natural Stone Yards" vs "Tile &
 * Surfaces Showrooms" is genuinely ambiguous from the name alone, and the seed
 * descriptions ("Marble, granite, quartzite… slab galleries" vs "Ceramic,
 * porcelain, glass… tile retailers") are what disambiguate them.
 *
 * Returned ids are validated against the live set before use — a hallucinated
 * id is dropped, never inserted.
 */
async function classifyCategoriesWithAI(
  env: Env,
  ctx: {
    name: string;
    description?: string | null;
    reviewSummary?: string | null;
    brands: string[];
    tokens: string[];
  },
  validCategories: Array<{ id: number; name: string; description: string | null }>,
): Promise<number[]> {
  if (validCategories.length === 0) return [];
  try {
    const ai = await createGeminiAiGatewayClient(env, "showroom_categorize");

    const context = [
      `Name: ${ctx.name}`,
      ctx.description ? `Description: ${ctx.description}` : null,
      ctx.reviewSummary ? `Review summary: ${ctx.reviewSummary}` : null,
      ctx.brands.length ? `Stocked/associated brands: ${ctx.brands.join(", ")}` : null,
      ctx.tokens.length ? `Google place types: ${ctx.tokens.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const prompt = `You are an expert architectural, construction, and interior design sourcing assistant categorizing a home-renovation showroom / vendor for a homeowner's sourcing directory.

Think like a trade-show brochure: what primary categories would this business be listed under? SELECT THE 1 TO 3 MOST APPLICABLE categories — do NOT over-categorize. Order them by relevance, most central to the business FIRST: the FIRST id is the store's PRIMARY category, the single group it appears under on the directory, so pick the grouping a homeowner would most expect to find this store in. Only choose a category the context clearly supports; if the specialty is genuinely unclear, return your single best guess rather than nothing. You MUST use only the ids below — do NOT invent categories.

Return the numeric id of each chosen category (1 to 3), most relevant first. Ids must come from this list:
${validCategories
      .map((c) => `${c.id}: ${c.name}${c.description ? ` — ${c.description}` : ""}`)
      .join("\n")}

SHOWROOM CONTEXT:
${context}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            categoryIds: {
              type: Type.ARRAY,
              items: { type: Type.INTEGER },
              description: "Category primary keys, most relevant first.",
            },
          },
          required: ["categoryIds"],
        },
        temperature: 0.1,
      },
    });

    const raw = response.text || "";
    // A primitive (null / number / string / bool) means the model did not answer
    // the question. Falling through to [] would look identical to "this store
    // genuinely has no categories" — the silent-degradation shape that hid the
    // blank-scrape bug for months. Throw so the catch logs it as a real failure.
    const decoded = JSON.parse(stripJsonFence(raw)) as unknown;
    if (typeof decoded !== "object" || decoded === null) {
      throw new Error(
        `AI category response was not a JSON object (got ${typeof decoded})`,
      );
    }
    const parsed = decoded as { categoryIds?: unknown };
    if (!Array.isArray(parsed.categoryIds)) return [];
    // Validate against the live set — a hallucinated id must never reach an
    // INSERT, where it would either violate the FK or mis-file the store.
    const valid = new Set(validCategories.map((c) => c.id));
    return parsed.categoryIds
      .map((n) => (typeof n === "number" ? n : Number.parseInt(String(n), 10)))
      .filter((n) => Number.isInteger(n) && valid.has(n))
      // Cap at 3 (belt-and-suspenders vs the prompt) so a runaway model can't
      // re-scatter a store across categories. First stays the primary.
      .slice(0, 3);
  } catch (err) {
    console.error(`[categories] AI classification failed for "${ctx.name}":`, err);
    return [];
  }
}

/**
 * Infer categories for a showroom and persist `showroom_store_category_mapping`
 * rows. FILL-BLANKS ONLY: no-ops when the store already has any category
 * mapping.
 *
 * Resolution order: an AI classifier reads the store's own context (name,
 * description, review summary, stocked brands, place types) and picks from the
 * live vocabulary; the regex token rules run as a cheap fallback/augment so the
 * store is still categorized if the AI call is unavailable. AI-chosen names are
 * inserted FIRST (relevance-ordered) so the store's "primary" category — the one
 * the map colours by — is meaningful. Never throws — failures log and return 0.
 *
 * @param env        Worker env (D1 + Gemini).
 * @param showroomId Target `showroom_stores.id`.
 * @param tokens     Signal strings (place types, primaryType, brand types).
 * @param rationale  Human-readable provenance stored on each mapping row.
 * @returns Number of mapping rows written.
 */
export async function inferAndMapCategories(
  env: Env,
  showroomId: number,
  tokens: Array<string | null | undefined>,
  rationale: string,
): Promise<number> {
  try {
    const db = drizzle(env.DB);

    // Fill-blanks guard: existing mappings win (user- or AI-assigned).
    const [existing] = await db
      .select({ id: showroomStoreCategoryMapping.id })
      .from(showroomStoreCategoryMapping)
      .where(eq(showroomStoreCategoryMapping.storeId, showroomId))
      .limit(1);
    if (existing) return 0;

    const categories = await db
      // `description` is fetched because the AI classifier needs it: the seed
      // descriptions are what separate "Slab & Natural Stone Yards" (slab
      // galleries) from "Tile & Surfaces Showrooms" (tile retailers), which the
      // names alone leave genuinely ambiguous.
      .select({
        id: showroomStoreCategory.id,
        name: showroomStoreCategory.name,
        description: showroomStoreCategory.description,
      })
      .from(showroomStoreCategory)
      .where(eq(showroomStoreCategory.isActive, true));
    if (categories.length === 0) return 0;

    // Store context for the AI classifier (name/description/summary/brands).
    const [store] = await db
      .select({
        name: showroomStores.name,
        description: showroomStores.description,
        reviewSummary: showroomStores.reviewSummary,
        reviewAiInsight: showroomStores.reviewAiInsight,
      })
      .from(showroomStores)
      .where(eq(showroomStores.id, showroomId))
      .limit(1);

    const cleanTokens = tokens.filter(
      (t): t is string => typeof t === "string" && t.trim().length > 0,
    );
    const brandNames = (store?.reviewAiInsight?.brands ?? [])
      .map((b) => (typeof b?.name === "string" ? b.name : null))
      .filter((n): n is string => Boolean(n));

    // 1. AI classification against the exact vocabulary (primary signal).
    //    Returns primary keys, not names — see classifyCategoriesWithAI.
    const aiIds = store?.name
      ? await classifyCategoriesWithAI(
          env,
          {
            name: store.name,
            description: store.description,
            reviewSummary: store.reviewSummary,
            brands: brandNames,
            tokens: cleanTokens,
          },
          categories,
        )
      : [];

    // 2. Regex token rules — cheap fallback/augment (esp. if the AI call failed).
    const regexLabels = inferCategoryLabelsFromTokens(tokens);

    // AI ids first (relevance-ordered — the first becomes the store's primary
    // category), then any regex labels the AI missed.
    const categoryIds: number[] = [];
    const pushId = (id: number) => {
      if (!categoryIds.includes(id)) categoryIds.push(id);
    };
    const pushMatch = (candidate: string) => {
      // Regex labels are canonical names, so an exact compare is sufficient.
      // The old fuzzy branch is what let "Flooring" bind to "Hardwood &
      // Flooring Specialists" and mis-file every tile and stone yard.
      const needle = candidate.toLowerCase();
      const match = categories.find((c) => c.name.toLowerCase() === needle);
      if (match) pushId(match.id);
    };
    for (const id of aiIds) pushId(id);
    // Exact, not fuzzy. The regex labels are now canonical category names, so
    // the fuzzy branch is no longer needed here — and fuzzy is precisely what let
    // "Flooring" swallow "Hardwood & Flooring Specialists". The AI path above
    // already used exact matching for the same reason.
    for (const label of regexLabels) pushMatch(label);

    if (categoryIds.length === 0) return 0;

    const usedAi = aiIds.length > 0;
    for (const [i, categoryId] of categoryIds.entries()) {
      await db.insert(showroomStoreCategoryMapping).values({
        storeId: showroomId,
        categoryId,
        aiRationale: rationale,
        // Higher confidence when the LLM read the store context; mid otherwise.
        aiRationaleConfidenceScore: usedAi ? 7 : 5,
        // First id (most relevant) is the store's ONE primary category — decides
        // the single directory group it appears under. The partial-unique index
        // (sscm_one_primary_per_store) enforces at-most-one; fill-blanks only runs
        // when the store has zero mappings, so there's no prior primary to collide.
        isPrimary: i === 0,
      });
    }
    return categoryIds.length;
  } catch (err) {
    console.error(`[categories] inference failed for store ${showroomId}:`, err);
    return 0;
  }
}

/**
 * DRY-RUN classify — predict a store's categories WITHOUT writing any
 * `showroom_store_category_mapping` rows. Mirrors `inferAndMapCategories`'
 * resolution (AI-first, then regex-token fallback, first id = primary) but
 * returns the prediction for human review instead of persisting it. Used by the
 * uncategorized-stores review report so a human greenlights before any write.
 */
export interface CategoryDryRunPrediction {
  storeId: number;
  name: string | null;
  /** Predicted categories, most-relevant first; `isPrimary` marks the first. */
  predicted: Array<{ id: number; name: string; isPrimary: boolean }>;
  /** True when the LLM produced the prediction (vs regex-token fallback only). */
  usedAi: boolean;
  /**
   * True when the store had only its name to go on — no description, no review
   * summary, no known brands — so the guess is weak and may warrant a scrape
   * first. This is the flag Justin reviews.
   */
  lowContext: boolean;
  /** Safety: true if the store already has mappings (should be excluded upstream). */
  hasExistingCategories: boolean;
}

export async function classifyStoreCategoriesDryRun(
  env: Env,
  showroomId: number,
  tokens: Array<string | null | undefined> = [],
): Promise<CategoryDryRunPrediction> {
  const db = drizzle(env.DB);

  const [existing] = await db
    .select({ id: showroomStoreCategoryMapping.id })
    .from(showroomStoreCategoryMapping)
    .where(eq(showroomStoreCategoryMapping.storeId, showroomId))
    .limit(1);

  const categories = await db
    .select({
      id: showroomStoreCategory.id,
      name: showroomStoreCategory.name,
      description: showroomStoreCategory.description,
    })
    .from(showroomStoreCategory)
    .where(eq(showroomStoreCategory.isActive, true));

  const [store] = await db
    .select({
      name: showroomStores.name,
      description: showroomStores.description,
      reviewSummary: showroomStores.reviewSummary,
      reviewAiInsight: showroomStores.reviewAiInsight,
    })
    .from(showroomStores)
    .where(eq(showroomStores.id, showroomId))
    .limit(1);

  const cleanTokens = tokens.filter(
    (t): t is string => typeof t === "string" && t.trim().length > 0,
  );
  const brandNames = (store?.reviewAiInsight?.brands ?? [])
    .map((b) => (typeof b?.name === "string" ? b.name : null))
    .filter((n): n is string => Boolean(n));

  const aiIds =
    store?.name && categories.length
      ? await classifyCategoriesWithAI(
          env,
          {
            name: store.name,
            description: store.description,
            reviewSummary: store.reviewSummary,
            brands: brandNames,
            tokens: cleanTokens,
          },
          categories,
        )
      : [];

  // Same merge order as the write path: AI ids first (first = primary), then any
  // regex-token labels the AI missed, matched EXACTLY against canonical names.
  const byId = new Map(categories.map((c) => [c.id, c.name] as const));
  const ids: number[] = [];
  const pushId = (id: number) => {
    if (!ids.includes(id)) ids.push(id);
  };
  for (const id of aiIds) pushId(id);
  for (const label of inferCategoryLabelsFromTokens(tokens)) {
    const needle = label.toLowerCase();
    const match = categories.find((c) => c.name.toLowerCase() === needle);
    if (match) pushId(match.id);
  }

  const predicted = ids
    .map((id) => ({ id, name: byId.get(id) }))
    .filter((p): p is { id: number; name: string } => Boolean(p.name))
    .map((p, i) => ({ ...p, isPrimary: i === 0 }));

  return {
    storeId: showroomId,
    name: store?.name ?? null,
    predicted,
    usedAi: aiIds.length > 0,
    // Only the name to go on — everything else that feeds the classifier is empty.
    lowContext: !store?.description && !store?.reviewSummary && brandNames.length === 0,
    hasExistingCategories: Boolean(existing),
  };
}
