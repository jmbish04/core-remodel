/**
 * @fileoverview Consolidate the brand-type taxonomy: merge duplicate types,
 * backfill AI descriptions + rationale, and flag the unambiguous primary type.
 *
 * WHY. Brand types accreted to 43 rows, many of them the same category under a
 * plural or a synonym — "Cabinets" and "Cabinetry", "Fabrics" and "Textiles",
 * "Wallpaper" and "Wallcoverings". A brand tagged "Cabinets" and another tagged
 * "Cabinetry" are the same kind of brand; two rows split what should be one
 * filter facet and one badge.
 *
 * SCOPE — deliberately conservative. This merges only the INDISPUTABLE
 * synonym/plural pairs, resolved by name so it is environment-independent and
 * idempotent. It does NOT split the compound types ("Windows & Doors",
 * "Paint & Wallpaper", …) into their atomic parts, nor collapse the fuzzier
 * material groupings (Quartz / Porcelain / Slabs): those are judgment calls that
 * change how brands are categorised and deserve a human's eye, not an
 * autonomous destructive migration. They are tracked as a follow-up.
 *
 * ORDER MATTERS. `brand_type_mappings.type_id` is `ON DELETE CASCADE`, so
 * deleting a loser type BEFORE repointing its mappings would silently drop those
 * mappings. Every merge repoints first, then deletes the now-orphan type.
 */

import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { brandTypesDef } from "@backend/db/schema/brands/brand_types_def";
import { brandTypeMappings } from "@backend/db/schema/brands/brand_type_mappings";
import { generateStructuredOutput } from "@backend/ai/providers";
import { z } from "@hono/zod-openapi";

/**
 * Survivor name → the synonym/plural names folded into it.
 *
 * Matched case-insensitively. A survivor that does not yet exist is created by
 * promoting (renaming) the first present loser, so the merge still runs in an
 * environment whose type names differ slightly. Names not present are skipped.
 *
 * Only high-confidence synonyms live here — if a pair is even arguably two
 * different categories, it is left alone.
 */
const CANONICAL_MERGES: Record<string, string[]> = {
  Cabinetry: ["Cabinets"],
  Flooring: ["Floorcoverings", "Floor Coverings"],
  Fabrics: ["Textiles"],
  Wallcoverings: ["Wallpaper", "Wallpapers"],
  Paint: ["Paint Supplies"],
};

export interface ConsolidationReport {
  merges: Array<{ survivor: string; absorbed: string; remapped: number; collisionsDropped: number }>;
  typesBefore: number;
  typesAfter: number;
  primariesSet: number;
  described: number;
}

/** Lowercased-name → row, for name-based resolution independent of ids. */
async function typesByName(db: ReturnType<typeof drizzle>) {
  const rows = await db.select().from(brandTypesDef);
  const byName = new Map<string, (typeof rows)[number]>();
  for (const r of rows) byName.set(r.name.trim().toLowerCase(), r);
  return { rows, byName };
}

/**
 * Merge one loser type into a survivor. Repoints mappings first (cascade-safe),
 * dropping any that would collide with an existing (brand, survivor) mapping,
 * then deletes the loser. Returns counts; a no-op if the loser is absent.
 */
async function mergeType(
  db: ReturnType<typeof drizzle>,
  survivorId: number,
  loserId: number,
): Promise<{ remapped: number; collisionsDropped: number }> {
  if (survivorId === loserId) return { remapped: 0, collisionsDropped: 0 };

  // Brands already carrying the survivor — remapping the loser onto them would
  // violate the unique (brand_id, type_id) index, so those loser rows are
  // dropped rather than remapped.
  const survivorBrands = await db
    .select({ brandId: brandTypeMappings.brandId })
    .from(brandTypeMappings)
    .where(eq(brandTypeMappings.typeId, survivorId));
  const survivorBrandIds = survivorBrands.map((r) => r.brandId);

  let collisionsDropped = 0;
  if (survivorBrandIds.length > 0) {
    const dropped = await db
      .delete(brandTypeMappings)
      .where(
        and(
          eq(brandTypeMappings.typeId, loserId),
          inArray(brandTypeMappings.brandId, survivorBrandIds),
        ),
      )
      .returning({ id: brandTypeMappings.id });
    collisionsDropped = dropped.length;
  }

  const remapped = await db
    .update(brandTypeMappings)
    .set({ typeId: survivorId })
    .where(eq(brandTypeMappings.typeId, loserId))
    .returning({ id: brandTypeMappings.id });

  // Safe now: no mapping references the loser, so the cascade deletes nothing.
  await db.delete(brandTypesDef).where(eq(brandTypesDef.id, loserId));

  return { remapped: remapped.length, collisionsDropped };
}

const DescribedTypeSchema = z.object({
  types: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      aiRationale: z.string(),
    }),
  ),
});

/**
 * The whole taxonomy cleanup, run as one idempotent operation.
 *
 * Idempotent: re-running after everything is merged and described is a near
 * no-op — absent losers are skipped and only types still missing a description
 * are sent to the model.
 */
export async function consolidateBrandTypes(env: Env): Promise<ConsolidationReport> {
  const db = drizzle(env.DB);
  const report: ConsolidationReport = {
    merges: [],
    typesBefore: 0,
    typesAfter: 0,
    primariesSet: 0,
    described: 0,
  };

  const before = await typesByName(db);
  report.typesBefore = before.rows.length;

  // ── 1. Merge synonym/plural pairs ────────────────────────────────────────
  for (const [survivorName, loserNames] of Object.entries(CANONICAL_MERGES)) {
    let survivor = before.byName.get(survivorName.toLowerCase());

    // Survivor absent → promote the first present loser by renaming it, so its
    // mappings are preserved for free and the remaining losers fold into it.
    if (!survivor) {
      const promoteName = loserNames.find((n) => before.byName.get(n.toLowerCase()));
      if (!promoteName) continue; // neither survivor nor any loser exists
      const toPromote = before.byName.get(promoteName.toLowerCase())!;
      await db
        .update(brandTypesDef)
        .set({ name: survivorName })
        .where(eq(brandTypesDef.id, toPromote.id));
      survivor = { ...toPromote, name: survivorName };
      before.byName.set(survivorName.toLowerCase(), survivor);
    }

    for (const loserName of loserNames) {
      const loser = before.byName.get(loserName.toLowerCase());
      if (!loser || loser.id === survivor.id) continue;
      const { remapped, collisionsDropped } = await mergeType(db, survivor.id, loser.id);
      before.byName.delete(loserName.toLowerCase());
      report.merges.push({
        survivor: survivorName,
        absorbed: loserName,
        remapped,
        collisionsDropped,
      });
    }
  }

  // ── 2. Flag the unambiguous primary ──────────────────────────────────────
  // ponytail: only single-type brands get a primary here — that is the sole
  // case with no ambiguity. Multi-type brands stay unweighted until the AI
  // classifier assigns one (P4-04), rather than inventing a bad heuristic like
  // "whichever type is globally most common", which would make every brand's
  // primary come out Plumbing or Appliances.
  await db.update(brandTypeMappings).set({ isPrimary: false });
  const singles = await db
    .select({ brandId: brandTypeMappings.brandId })
    .from(brandTypeMappings)
    .groupBy(brandTypeMappings.brandId)
    .having(sql`COUNT(*) = 1`);
  const singleBrandIds = singles.map((r) => r.brandId);
  for (let i = 0; i < singleBrandIds.length; i += 50) {
    const chunk = singleBrandIds.slice(i, i + 50);
    const updated = await db
      .update(brandTypeMappings)
      .set({ isPrimary: true })
      .where(inArray(brandTypeMappings.brandId, chunk))
      .returning({ id: brandTypeMappings.id });
    report.primariesSet += updated.length;
  }

  // ── 3. Backfill descriptions + rationale for types that lack one ──────────
  const undescribed = await db
    .select({ id: brandTypesDef.id, name: brandTypesDef.name })
    .from(brandTypesDef)
    .where(isNull(brandTypesDef.description));

  if (undescribed.length > 0) {
    const systemPrompt = `You are cataloguing the brand-type taxonomy for a high-end home-renovation sourcing platform. For each brand type below, write:
- description: one or two sentences on what kind of products brands of this type make and where they sit in a renovation (materials, fixtures, finishes, furnishings). Concrete, not generic marketing prose.
- aiRationale: a brief note on how you interpreted the type name and why the description scopes it the way it does — especially any boundary calls (e.g. why "Slabs" is stone surfaces, not wood).

Return every type you were given, keyed by its exact name.`;

    // Chunk the generation. A single call asking for ALL undescribed types at
    // once silently truncates: the model defaults to max_tokens 4096, and a few
    // dozen description + rationale pairs run well past that, so the JSON comes
    // back cut off, `schema.parse` throws, and the whole backfill lands as zero.
    // Ten per call keeps each response comfortably inside the cap. Each chunk is
    // independent — a bad batch is logged and skipped, the rest still write, and
    // its types stay null for a later re-run. We never write empty over null.
    const DESCRIBE_CHUNK = 10;
    for (let i = 0; i < undescribed.length; i += DESCRIBE_CHUNK) {
      const batch = undescribed.slice(i, i + DESCRIBE_CHUNK);
      const userPrompt = `Types:\n${batch.map((t) => `- ${t.name}`).join("\n")}`;

      let described: z.infer<typeof DescribedTypeSchema> | null = null;
      try {
        described = await generateStructuredOutput(env, {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          schema: DescribedTypeSchema,
          schemaName: "BrandTypeDescriptions",
          temperature: 0,
        });
      } catch (err) {
        console.error(
          `[type-consolidation] description backfill failed for batch ${i / DESCRIBE_CHUNK}:`,
          err,
        );
        continue;
      }

      const byName = new Map(
        described.types.map((t) => [t.name.trim().toLowerCase(), t]),
      );
      for (const t of batch) {
        const d = byName.get(t.name.trim().toLowerCase());
        if (!d?.description) continue; // skip rather than store an empty string
        await db
          .update(brandTypesDef)
          .set({ description: d.description, aiRationale: d.aiRationale ?? null })
          .where(eq(brandTypesDef.id, t.id));
        report.described++;
      }
    }
  }

  report.typesAfter = (await db.select({ id: brandTypesDef.id }).from(brandTypesDef)).length;
  return report;
}
