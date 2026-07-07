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

import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import {
  showroomStoreCategory,
  showroomStoreCategoryMapping,
} from "@backend/db/schema/showroom/index";

/**
 * Ordered rules mapping type/brand tokens to internal category NAMES. Each rule
 * tests the combined lowercased haystack; matches contribute one or more
 * category names, de-duplicated in insertion order.
 */
const CATEGORY_RULES: { test: RegExp; labels: string[] }[] = [
  // Furniture / home goods / decor
  { test: /home_goods_store|furniture_store|home_improvement_store/, labels: ["Furniture"] },
  { test: /home_goods_store/, labels: ["Art & Accessories"] },
  // Hardware & doors
  { test: /hardware_store/, labels: ["Doors & Hardware"] },
  { test: /door/, labels: ["Doors & Hardware"] },
  // Plumbing / bath
  { test: /plumbing|plumber/, labels: ["Plumbing Fixtures"] },
  { test: /bath|bathroom/, labels: ["Bathroom Tile", "Bathroom Vanities"] },
  // Lighting
  { test: /lighting_store|lighting|light_fixture/, labels: ["Lighting"] },
  // Tile / stone / flooring
  { test: /tile|stone|flooring|floor|carpet|hardwood/, labels: ["Flooring"] },
  { test: /tile/, labels: ["Bathroom Tile"] },
  { test: /countertop|slab|granite|quartz|marble/, labels: ["Kitchen Countertops"] },
  // Kitchen
  { test: /kitchen|cabinet/, labels: ["Kitchen Cabinetry"] },
  // Appliances
  { test: /appliance|electronics_store/, labels: ["Appliances"] },
  // Windows
  { test: /window/, labels: ["Windows"] },
  // Closets / storage
  { test: /closet|storage|organiz/, labels: ["Closet Systems"] },
  // Paint & finishes
  { test: /paint/, labels: ["Paint & Finishes"] },
  // Rugs / textiles
  { test: /rug|carpet|textile|fabric|drapery/, labels: ["Rugs & Textiles"] },
  // Wall coverings
  { test: /wallpaper|wall_covering/, labels: ["Wall Coverings"] },
  // Smart home
  { test: /smart_home|home_automation|locksmith/, labels: ["Smart Home"] },
  // Outdoor
  { test: /garden|landscap|outdoor|nursery|patio/, labels: ["Outdoor & Landscape"] },
  // Water filtration
  { test: /water|filtration/, labels: ["Water Filtration"] },
];

/**
 * Infer internal showroom category NAMES from a set of signal tokens (Google
 * place types, primaryType, AI-insight brand type strings).
 *
 * @param tokens Raw signal strings; joined + lowercased into one haystack.
 * @returns De-duplicated internal category names (insertion order). May be empty.
 */
export function inferCategoryLabelsFromTokens(tokens: Array<string | null | undefined>): string[] {
  const haystack = tokens.filter(Boolean).join(" ").toLowerCase();
  if (!haystack.trim()) return [];
  const out: string[] = [];
  for (const { test, labels } of CATEGORY_RULES) {
    if (test.test(haystack)) {
      for (const label of labels) {
        if (!out.includes(label)) out.push(label);
      }
    }
  }
  return out;
}

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
      const match = categories.find((c) => {
        const name = c.name.toLowerCase();
        return name.includes(needle) || needle.includes(name);
      });
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
