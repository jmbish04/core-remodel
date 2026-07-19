/**
 * @fileoverview Server-side showroom category inference + persistence.
 *
 * Maps free-text signal tokens onto the internal showroom category vocabulary,
 * then writes `showroom_store_category_mapping` rows — FILL-BLANKS ONLY (a store
 * that already has any category mapping is left untouched).
 *
 * TOKENS ARE NOT GOOGLE-SPECIFIC. This used to be fed exclusively by Google
 * Places `types`/`primaryType`. It now takes any text: the store NAME (by far the
 * strongest signal — "Archetype Lighting", "Tez Marble", "Tileshop"), the
 * description, mapped brand names, and scraped page text. Places is no longer
 * required for a store to get categorised.
 *
 * WHY THIS FILE WAS REWRITTEN (2026-07-16). The rule table emitted labels from an
 * OLDER category vocabulary and was never updated when the live vocabulary
 * changed, while resolution used a fuzzy bidirectional `includes` match that hid
 * the breakage. Measured against the live 28-row `showroom_store_category` table:
 *
 *   - 15 of 19 emitted labels resolved to NOTHING ("Plumbing Fixtures",
 *     "Kitchen Cabinetry", "Appliances", "Closet Systems", "Smart Home", …).
 *   - The 4 that did resolve were WRONG: the single rule `/tile|stone|flooring/`
 *     emitted "Flooring", which fuzzy-matched "Hardwood & Flooring Specialists",
 *     so every tile and stone yard in the directory was filed as a hardwood
 *     flooring specialist. "Tileshop", "Art Tile", "All Natural Stone" and
 *     "Italics Tile & Stone" all landed there.
 *
 * That is why 86 of 146 stores carried zero categories.
 *
 * TWO STRUCTURAL FIXES so it cannot silently rot again:
 *   1. Rules emit CANONICAL_CATEGORIES members — the exact live names — and the
 *      type system rejects any other string at compile time.
 *   2. Resolution is an EXACT case-insensitive name match. The old fuzzy contains
 *      match is what let "Flooring" swallow "Hardwood & Flooring Specialists".
 *
 * `scripts/tests/test_showroom_categories.mjs` asserts every rule label is a real
 * category and pins the classification of real store names.
 */

import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import {
  showroomStoreCategory,
  showroomStoreCategoryMapping,
} from "@backend/db/schema/showroom/index";
import {
  CANONICAL_CATEGORIES,
  type CanonicalCategory,
  inferCategoryLabelsFromTokens,
} from "./showroom-category-rules";

// Re-exported so existing importers of this module keep working unchanged.
export { CANONICAL_CATEGORIES, inferCategoryLabelsFromTokens };
export type { CanonicalCategory };


/**
 * Infer categories for a showroom and persist `showroom_store_category_mapping`
 * rows. FILL-BLANKS ONLY: no-ops when the store already has any category
 * mapping. Resolution against the live vocabulary is a case-insensitive
 * bidirectional contains match (mirrors the intake UI's resolution). Never
 * throws — failures log and return 0.
 *
 * @param env        Worker env (D1 binding).
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

    const labels = inferCategoryLabelsFromTokens(tokens);
    if (labels.length === 0) return 0;

    const categories = await db
      .select({ id: showroomStoreCategory.id, name: showroomStoreCategory.name })
      .from(showroomStoreCategory)
      .where(eq(showroomStoreCategory.isActive, true));

    const categoryIds: number[] = [];
    for (const label of labels) {
      const needle = label.toLowerCase();
      // EXACT match. The old `name.includes(needle) || needle.includes(name)`
      // fuzzy compare is what let the label "Flooring" bind to "Hardwood &
      // Flooring Specialists", mis-filing every tile and stone yard in the
      // directory. Rules now emit canonical names, so exact is sufficient — and
      // a rule that drifts from the vocabulary fails the test instead of
      // silently binding to the wrong category.
      const match = categories.find((c) => c.name.toLowerCase() === needle);
      if (match && !categoryIds.includes(match.id)) categoryIds.push(match.id);
    }
    if (categoryIds.length === 0) return 0;

    for (const categoryId of categoryIds) {
      await db.insert(showroomStoreCategoryMapping).values({
        storeId: showroomId,
        categoryId,
        aiRationale: rationale,
        // Mid-scale confidence: inferred from structured signals, not verified.
        aiRationaleConfidenceScore: 5,
      });
    }
    return categoryIds.length;
  } catch (err) {
    console.error(`[categories] inference failed for store ${showroomId}:`, err);
    return 0;
  }
}
