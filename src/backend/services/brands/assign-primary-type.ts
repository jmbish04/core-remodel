/**
 * @fileoverview Assign the primary brand type for MULTI-type brands via AI.
 *
 * The consolidation flags a primary only for single-type brands — the one case
 * with no ambiguity. A brand carrying several types (e.g. a plumbing house that
 * also sells hardware, or any brand a compound-type split turned multi-type) is
 * deliberately left unweighted there, because "most globally common type wins"
 * would make every brand's primary come out Plumbing or Appliances.
 *
 * This closes that gap: for each multi-type brand, the model is shown the brand
 * and ITS OWN types and picks which one leads. The choice is validated against
 * that brand's type ids before any write — the model can only ever pick from
 * the types the brand already has, never invent one.
 *
 * Batched (10 brands per call) for the same reason the description backfill is:
 * one call for every multi-type brand would truncate against the 4096-token
 * default. Each batch is independent — a bad one is logged and skipped.
 */

import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, sql } from "drizzle-orm";

import { brands } from "@backend/db/schema/brands/brands";
import { brandTypesDef } from "@backend/db/schema/brands/brand_types_def";
import { brandTypeMappings } from "@backend/db/schema/brands/brand_type_mappings";
import { generateStructuredOutput } from "@backend/ai/providers";
import { z } from "@hono/zod-openapi";

const BATCH = 10;

const AssignmentSchema = z.object({
  assignments: z.array(
    z.object({
      brandId: z.number(),
      primaryTypeId: z.number(),
    }),
  ),
});

export interface PrimaryAssignmentReport {
  multiTypeBrands: number;
  assigned: number;
  /** Model picked a type the brand does not carry — rejected, not written. */
  invalidPicks: number;
  skipped: number;
}

/** A brand plus the types it currently carries. */
interface BrandTypes {
  id: number;
  name: string;
  description: string | null;
  types: Array<{ id: number; name: string; description: string | null }>;
}

/**
 * Assign `is_primary` to one type per multi-type brand.
 *
 * NEVER throws on a per-batch AI failure — the batch is logged and skipped, its
 * brands stay unweighted for a later re-run. Idempotent: re-running re-derives
 * the same picks and rewrites the same flags.
 */
export async function assignPrimaryTypes(env: Env): Promise<PrimaryAssignmentReport> {
  const db = drizzle(env.DB);
  const report: PrimaryAssignmentReport = {
    multiTypeBrands: 0,
    assigned: 0,
    invalidPicks: 0,
    skipped: 0,
  };

  // Brands carrying more than one type — the only ones needing a judgement call.
  const multi = await db
    .select({ brandId: brandTypeMappings.brandId })
    .from(brandTypeMappings)
    .groupBy(brandTypeMappings.brandId)
    .having(sql`COUNT(*) > 1`);
  const multiBrandIds = multi.map((r) => r.brandId);
  report.multiTypeBrands = multiBrandIds.length;
  if (multiBrandIds.length === 0) return report;

  // Pull each brand + its types in bulk, then group in memory — one query per
  // table rather than one per brand.
  const brandRows = await db
    .select({ id: brands.id, name: brands.name, description: brands.description })
    .from(brands)
    .where(inArray(brands.id, multiBrandIds));

  const mappingRows = await db
    .select({
      brandId: brandTypeMappings.brandId,
      typeId: brandTypesDef.id,
      typeName: brandTypesDef.name,
      typeDescription: brandTypesDef.description,
    })
    .from(brandTypeMappings)
    .innerJoin(brandTypesDef, eq(brandTypesDef.id, brandTypeMappings.typeId))
    .where(inArray(brandTypeMappings.brandId, multiBrandIds));

  const byBrand = new Map<number, BrandTypes>();
  for (const b of brandRows) {
    byBrand.set(b.id, { id: b.id, name: b.name, description: b.description, types: [] });
  }
  for (const m of mappingRows) {
    byBrand
      .get(m.brandId)
      ?.types.push({ id: m.typeId, name: m.typeName, description: m.typeDescription });
  }

  const systemPrompt = `You classify home-renovation brands. Each brand below lists the product types it carries. For every brand, choose the ONE type that best represents what the brand is primarily known for — a plumbing house that also sells a few fixtures is primarily Plumbing.

Return one assignment per brand, using the brand's numeric id and the numeric id of the chosen type. You MUST pick primaryTypeId from the type ids listed for that brand — never any other id.`;

  const workable = [...byBrand.values()].filter((b) => b.types.length > 0);

  for (let i = 0; i < workable.length; i += BATCH) {
    const batch = workable.slice(i, i + BATCH);
    const userPrompt = `Brands:\n${batch
      .map(
        (b) =>
          `Brand ${b.id} — ${b.name}${b.description ? ` (${b.description})` : ""}\n  types: ${b.types
            .map((t) => `${t.id}=${t.name}`)
            .join(", ")}`,
      )
      .join("\n")}`;

    let result: z.infer<typeof AssignmentSchema> | null = null;
    try {
      result = await generateStructuredOutput(env, {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        schema: AssignmentSchema,
        schemaName: "PrimaryTypeAssignments",
        temperature: 0,
      });
    } catch (err) {
      console.error(
        `[assign-primary] batch ${i / BATCH} failed:`,
        err,
      );
      report.skipped += batch.length;
      continue;
    }

    const picks = new Map(result.assignments.map((a) => [a.brandId, a.primaryTypeId]));
    for (const b of batch) {
      const pick = picks.get(b.id);
      if (pick === undefined) {
        report.skipped++;
        continue;
      }
      // Validate: the pick MUST be one of the brand's own types.
      if (!b.types.some((t) => t.id === pick)) {
        report.invalidPicks++;
        continue;
      }
      // Exactly one primary per brand: clear all, then set the chosen one.
      await db
        .update(brandTypeMappings)
        .set({ isPrimary: false })
        .where(eq(brandTypeMappings.brandId, b.id));
      await db
        .update(brandTypeMappings)
        .set({ isPrimary: true })
        .where(
          and(eq(brandTypeMappings.brandId, b.id), eq(brandTypeMappings.typeId, pick)),
        );
      report.assigned++;
    }
  }

  return report;
}
