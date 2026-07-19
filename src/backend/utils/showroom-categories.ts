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
async function classifyCategoriesWithAI(
  env: Env,
  ctx: {
    name: string;
    description?: string | null;
    reviewSummary?: string | null;
    brands: string[];
    tokens: string[];
  },
  validNames: string[],
): Promise<string[]> {
  if (validNames.length === 0) return [];
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

    const prompt = `You are categorizing a home-renovation showroom / vendor for a homeowner's sourcing directory.

Choose EVERY category from the allowed list below that this showroom clearly sells or specializes in. Order them by relevance, most central to the business FIRST. Only choose a category when the context supports it — do not guess wildly. If the showroom's specialty is genuinely unclear, return your single best guess rather than nothing.

You MUST return only names copied EXACTLY from this allowed list (verbatim, case-sensitive):
${validNames.map((nm) => `- ${nm}`).join("\n")}

SHOWROOM CONTEXT:
${context}

Respond with ONLY valid JSON: {"categories": ["Exact Name", ...]}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            categories: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ["categories"],
        },
        temperature: 0.1,
      },
    });

    const raw = response.text || "";
    const parsed = JSON.parse(stripJsonFence(raw)) as { categories?: unknown };
    if (!Array.isArray(parsed.categories)) return [];
    return parsed.categories.filter(
      (c): c is string => typeof c === "string" && c.trim().length > 0,
    );
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
      .select({ id: showroomStoreCategory.id, name: showroomStoreCategory.name })
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
    const aiNames = store?.name
      ? await classifyCategoriesWithAI(
          env,
          {
            name: store.name,
            description: store.description,
            reviewSummary: store.reviewSummary,
            brands: brandNames,
            tokens: cleanTokens,
          },
          categories.map((c) => c.name),
        )
      : [];

    // 2. Regex token rules — cheap fallback/augment (esp. if the AI call failed).
    const regexLabels = inferCategoryLabelsFromTokens(tokens);

    // AI names first (exact-match, relevance-ordered), then regex labels.
    const categoryIds: number[] = [];
    const pushMatch = (candidate: string, exactOnly: boolean) => {
      const needle = candidate.toLowerCase();
      const match = categories.find((c) => {
        const name = c.name.toLowerCase();
        return exactOnly ? name === needle : name.includes(needle) || needle.includes(name);
      });
      if (match && !categoryIds.includes(match.id)) categoryIds.push(match.id);
    };
    for (const nm of aiNames) pushMatch(nm, true);
    // Exact, not fuzzy. The regex labels are now canonical category names, so
    // the fuzzy branch is no longer needed here — and fuzzy is precisely what let
    // "Flooring" swallow "Hardwood & Flooring Specialists". The AI path above
    // already used exact matching for the same reason.
    for (const label of regexLabels) pushMatch(label, true);

    if (categoryIds.length === 0) return 0;

    const usedAi = aiNames.length > 0;
    for (const categoryId of categoryIds) {
      await db.insert(showroomStoreCategoryMapping).values({
        storeId: showroomId,
        categoryId,
        aiRationale: rationale,
        // Higher confidence when the LLM read the store context; mid otherwise.
        aiRationaleConfidenceScore: usedAi ? 7 : 5,
      });
    }
    return categoryIds.length;
  } catch (err) {
    console.error(`[categories] inference failed for store ${showroomId}:`, err);
    return 0;
  }
}
