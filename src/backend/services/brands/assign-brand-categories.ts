/**
 * @fileoverview Populate `brand_categories` — map brands to the SHARED category
 * vocabulary via AI.
 *
 * `brand_categories` sat empty because only a manual config route ever wrote it.
 * It is NOT the same thing as `brand_type_mappings`: `brand_types_def` is a fine
 * brand-specific vocabulary (Plumbing, Tile, Vanities, ~39 entries), while
 * `categories` is the small shared cross-cutting vocabulary (appliance, cabinet,
 * flooring, lighting, plumbing, stone, tile, other) that products, materials and
 * brands all classify against. A brand needs both: its types for the brand
 * facet, its categories for the cross-entity filters.
 *
 * The model is shown the brand plus the LIVE category set and returns category
 * ids, validated against that set before insert — it can only pick ids that
 * exist, never invent one. Existing mappings are preserved (onConflictDoNothing);
 * this only adds.
 */

import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import { brands } from "@backend/db/schema/brands/brands";
import { brandTypesDef } from "@backend/db/schema/brands/brand_types_def";
import { brandTypeMappings } from "@backend/db/schema/brands/brand_type_mappings";
import { categories } from "@backend/db/schema/config/categories";
import { brandCategories } from "@backend/db/schema/config/brand_categories";
import { generateStructuredOutput } from "@backend/ai/providers";
import { z } from "@hono/zod-openapi";

const BATCH = 10;

const CategoryAssignmentSchema = z.object({
  assignments: z.array(
    z.object({
      brandId: z.number(),
      categoryIds: z.array(z.number()),
    }),
  ),
});

export interface CategoryAssignmentReport {
  brands: number;
  brandsAssigned: number;
  mappingsAdded: number;
  invalidIdsDropped: number;
  skipped: number;
}

interface BrandContext {
  id: number;
  name: string;
  description: string | null;
  typeNames: string[];
}

/**
 * Assign shared categories to brands that have none yet.
 *
 * NEVER throws on a per-batch AI failure — the batch is logged and skipped.
 * Idempotent and additive: only brands with zero categories are processed, and
 * inserts are `onConflictDoNothing`, so a re-run never duplicates or churns.
 */
export async function assignBrandCategories(env: Env): Promise<CategoryAssignmentReport> {
  const db = drizzle(env.DB);
  const report: CategoryAssignmentReport = {
    brands: 0,
    brandsAssigned: 0,
    mappingsAdded: 0,
    invalidIdsDropped: 0,
    skipped: 0,
  };

  // The live vocabulary — the model is constrained to exactly these ids.
  const catRows = await db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.isActive, true));
  const validIds = new Set(catRows.map((c) => c.id));
  if (catRows.length === 0) return report;

  // Only brands with NO category yet — additive backfill, never a reclassify.
  const alreadyMapped = await db
    .select({ brandId: brandCategories.brandId })
    .from(brandCategories);
  const mappedSet = new Set(alreadyMapped.map((r) => r.brandId));

  const allBrands = await db
    .select({ id: brands.id, name: brands.name, description: brands.description })
    .from(brands);
  const targets = allBrands.filter((b) => !mappedSet.has(b.id));
  report.brands = targets.length;
  if (targets.length === 0) return report;

  const targetSet = new Set(targets.map((b) => b.id));

  // Each target brand's type names, for context — a brand's types strongly imply
  // its categories (a Tile + Slabs brand is a "stone"/"tile" brand).
  //
  // Fetch ALL mappings and filter in memory rather than `inArray(targetIds)`:
  // targetIds is every unmapped brand and can exceed 100, which trips D1's
  // 100-bound-parameter cap and throws. The mappings table is small, so one
  // unfiltered scan is cheaper than chunking the IN list.
  const typeRows = await db
    .select({ brandId: brandTypeMappings.brandId, typeName: brandTypesDef.name })
    .from(brandTypeMappings)
    .innerJoin(brandTypesDef, eq(brandTypesDef.id, brandTypeMappings.typeId));
  const typesByBrand = new Map<number, string[]>();
  for (const r of typeRows) {
    if (!targetSet.has(r.brandId)) continue;
    const arr = typesByBrand.get(r.brandId) ?? [];
    arr.push(r.typeName);
    typesByBrand.set(r.brandId, arr);
  }

  const ctx: BrandContext[] = targets.map((b) => ({
    id: b.id,
    name: b.name,
    description: b.description,
    typeNames: typesByBrand.get(b.id) ?? [],
  }));

  const catList = catRows.map((c) => `${c.id}=${c.name}`).join(", ");
  const systemPrompt = `You classify home-renovation brands into a fixed shared category vocabulary. The ONLY valid categories are: ${catList}.

For each brand, return the category ids that apply — usually one or two, occasionally more. You MUST choose only from the ids listed above; never return an id that is not in that list. If nothing fits, return the id for "other".`;

  for (let i = 0; i < ctx.length; i += BATCH) {
    const batch = ctx.slice(i, i + BATCH);
    const userPrompt = `Brands:\n${batch
      .map(
        (b) =>
          `Brand ${b.id} — ${b.name}${b.description ? ` (${b.description})` : ""}${
            b.typeNames.length ? `\n  types: ${b.typeNames.join(", ")}` : ""
          }`,
      )
      .join("\n")}`;

    let result: z.infer<typeof CategoryAssignmentSchema> | null = null;
    try {
      result = await generateStructuredOutput(env, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        schema: CategoryAssignmentSchema,
        schemaName: "BrandCategoryAssignments",
        temperature: 0,
      });
    } catch (err) {
      console.error(`[assign-categories] batch ${i / BATCH} failed:`, err);
      report.skipped += batch.length;
      continue;
    }

    const picks = new Map(result.assignments.map((a) => [a.brandId, a.categoryIds]));
    for (const b of batch) {
      const rawIds = picks.get(b.id);
      if (rawIds === undefined) {
        report.skipped++;
        continue;
      }
      // Keep only ids that exist in the live vocabulary; drop hallucinated ones.
      const valid = [...new Set(rawIds)].filter((id) => {
        if (validIds.has(id)) return true;
        report.invalidIdsDropped++;
        return false;
      });
      if (valid.length === 0) continue;

      const rows = valid.map((categoryId) => ({ brandId: b.id, categoryId }));
      const inserted = await db
        .insert(brandCategories)
        .values(rows)
        .onConflictDoNothing()
        .returning({ id: brandCategories.id });
      report.mappingsAdded += inserted.length;
      if (inserted.length > 0) report.brandsAssigned++;
    }
  }

  return report;
}
