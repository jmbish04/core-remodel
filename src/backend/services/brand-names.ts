/**
 * @fileoverview Brand display names + aliases, backed by `brand_name_variations`.
 *
 * The variations table is the source of truth for what a brand is CALLED:
 * exactly one `is_primary` row per brand is the display name, and every other
 * active row is a spelling the system has encountered and will match on later.
 *
 * `brands.name` still exists and is kept in sync by `setPrimaryBrandName`. It is
 * NOT yet removable: 36 call sites across 15 files still read it, and dropping a
 * column in SQLite rebuilds the table — which on D1 fires `ON DELETE CASCADE`
 * (PRAGMA foreign_keys=OFF is a no-op through wrangler) across the 7 tables that
 * reference `brands`, including 552 showroom mappings. Migrate the readers to
 * `primaryName` first, then drop the column with the backup -> rebuild -> restore
 * pattern.
 */

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { brands } from "@backend/db/schema/brands/brands";
import { brandNameVariations } from "@backend/db/schema/brands/brand_name_variations";

/** Any drizzle D1 handle — MCP tools and routes type theirs differently. */
type Db =
  | DrizzleD1Database<Record<string, never>>
  | DrizzleD1Database<Record<string, unknown>>;

export interface BrandWithNames {
  id: number;
  /** The `is_primary` variation, falling back to `brands.name` if none exists. */
  primaryName: string;
  /** Active non-primary spellings, deduped. */
  variations: string[];
  websiteUrl: string | null;
}

/**
 * Load brands with their display name and aliases attached.
 *
 * Two queries, not N+1: one for brands, one for every variation, joined in JS.
 */
export async function loadBrandsWithNames(
  db: Db,
  brandIds?: number[],
): Promise<BrandWithNames[]> {
  const brandRows = brandIds?.length
    ? await db.select().from(brands).where(inArray(brands.id, brandIds))
    : await db.select().from(brands);
  if (brandRows.length === 0) return [];

  const variationRows = await db
    .select()
    .from(brandNameVariations)
    .where(eq(brandNameVariations.isActive, true));

  const primary = new Map<number, string>();
  const aliases = new Map<number, Set<string>>();
  for (const row of variationRows) {
    if (row.isPrimary) primary.set(row.brandId, row.brandName);
    else {
      const set = aliases.get(row.brandId) ?? new Set<string>();
      set.add(row.brandName);
      aliases.set(row.brandId, set);
    }
  }

  return brandRows.map((brand) => ({
    id: brand.id,
    // Fall back to the legacy column so a brand created before this table
    // existed — or by a path not yet migrated — still renders a name.
    primaryName: primary.get(brand.id) ?? brand.name,
    variations: [...(aliases.get(brand.id) ?? [])],
    websiteUrl: brand.websiteUrl ?? null,
  }));
}

/**
 * Resolve any spelling of a brand to its id.
 *
 * THE point of the variations table. A hand-rolled
 * `where lower(brands.name) = lower(?)` only ever matches the display name, so
 * a source spelling it differently misses and the caller creates a duplicate —
 * which is exactly how the 9 duplicate pairs got made. This searches every
 * recorded spelling, so a miss means genuinely new, not merely differently
 * written.
 *
 * Case-insensitive and whitespace-tolerant. Returns null when unknown.
 */
export async function findBrandIdByAnyName(
  db: Db,
  name: string,
): Promise<number | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;

  const hits = await db
    .select({
      brandId: brandNameVariations.brandId,
      isPrimary: brandNameVariations.isPrimary,
    })
    .from(brandNameVariations)
    .where(
      and(
        sql`lower(trim(${brandNameVariations.brandName})) = lower(${trimmed})`,
        eq(brandNameVariations.isActive, true),
      ),
    );

  if (hits.length > 0) {
    // A spelling can legitimately map to more than one brand while duplicate
    // brand rows still exist — "DORN BRACHT" is #315's own primary name AND an
    // alias of #18 Dornbracht. Resolve deterministically by preferring the
    // brand that actually CALLS ITSELF this, rather than whichever row the DB
    // happened to return first. Merging the duplicates (agent issue #4) is what
    // removes the ambiguity for good.
    const primaryHit = hits.find((h) => h.isPrimary);
    if (!primaryHit && hits.length > 1) {
      console.warn(
        `[brand-names] "${trimmed}" is an alias of ${hits.length} brands ` +
          `(${hits.map((h) => h.brandId).join(", ")}) — resolving to the lowest id`,
      );
    }
    return primaryHit?.brandId ?? Math.min(...hits.map((h) => h.brandId));
  }

  // Fall back to the legacy column for any brand whose variation row is missing
  // — belt-and-braces, since the 0117 triggers keep the two in step.
  const [legacy] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(sql`lower(trim(${brands.name})) = lower(${trimmed})`)
    .limit(1);
  return legacy?.id ?? null;
}

/**
 * Record a spelling for a brand, without disturbing which one is primary.
 *
 * Called whenever a new spelling is encountered — a scrape, an import, a quote.
 * Silently no-ops when the spelling is already recorded, so callers can fire it
 * on every sighting.
 */
export async function addBrandNameVariation(
  db: Db,
  brandId: number,
  name: string,
): Promise<boolean> {
  const trimmed = name.trim();
  if (!trimmed) return false;

  const existing = await db
    .select()
    .from(brandNameVariations)
    .where(
      and(
        eq(brandNameVariations.brandId, brandId),
        eq(brandNameVariations.brandName, trimmed),
      ),
    );
  if (existing.length > 0) return false;

  await db
    .insert(brandNameVariations)
    .values({ brandId, brandName: trimmed, isActive: true, isPrimary: false });
  return true;
}

/**
 * Make `name` the brand's display name.
 *
 * Demotes the current primary rather than deleting it — the old spelling stays
 * a valid lookup key, which is the point: renaming "DORN BRACHT" to
 * "Dornbracht" must not stop the former from matching.
 *
 * Order matters. The partial unique index permits only one primary per brand,
 * so the demote MUST land before the promote or the write is rejected.
 */
export async function setPrimaryBrandName(
  db: Db,
  brandId: number,
  name: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;

  // 1. Demote any other primary first — see the ordering note above.
  await db
    .update(brandNameVariations)
    .set({ isPrimary: false })
    .where(
      and(
        eq(brandNameVariations.brandId, brandId),
        eq(brandNameVariations.isPrimary, true),
        ne(brandNameVariations.brandName, trimmed),
      ),
    );

  // 2. Promote, inserting the row if this spelling is new to the brand.
  const existing = await db
    .select()
    .from(brandNameVariations)
    .where(
      and(
        eq(brandNameVariations.brandId, brandId),
        eq(brandNameVariations.brandName, trimmed),
      ),
    );

  if (existing.length > 0) {
    await db
      .update(brandNameVariations)
      .set({ isPrimary: true, isActive: true })
      .where(eq(brandNameVariations.id, existing[0].id));
  } else {
    await db
      .insert(brandNameVariations)
      .values({ brandId, brandName: trimmed, isActive: true, isPrimary: true });
  }

  // 3. Keep the legacy column in step until its 36 readers are migrated.
  await db.update(brands).set({ name: trimmed }).where(eq(brands.id, brandId));
}
