import { findBrandIdByAnyName, setPrimaryBrandName } from "@backend/services/brand-names";
// src/backend/services/image-processor/intake-helpers.ts
/**
 * @fileoverview Shared showroom-photo-ingest helpers, lifted out of
 * `api/routes/product-photos.ts` (single-photo ingest) so `api/routes/intake.ts`
 * (the C2 multi-photo bucket intake wizard, Phase 2) can reuse the exact same
 * vocab-loading / brand-resolve / category-resolve / color-resolve / product-ensure
 * logic instead of forking a second copy. Both routers import from here now.
 */
import { drizzle } from "drizzle-orm/d1";
import { and, eq, sql } from "drizzle-orm";

import { brands, categories, colors, showroomStoreProducts } from "@backend/db";
import { normalizeModelKey } from "@backend/lib/normalize-model";
import type { ExtractionVocabContext, ProductExtraction } from "./product-extraction";

export type Db = ReturnType<typeof drizzle>;

/**
 * `data:<mime>;base64,<...>` -> Blob. Mirrors the local helper in
 * `api/routes/showroom-scan.ts` — lifted here so the intake `/uploads` endpoint
 * (which receives JSON `{ fileName, dataUrl }`, not multipart) can hand a Blob
 * to `ImageProcessorService.uploadToCloudflareImages`.
 */
export function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const [, mime, b64] = match;
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

/** Find (or create) the brand row matching `name`, case-insensitively. Null passthrough for no brand text. */
export async function resolveBrandId(db: Db, name: string | null | undefined): Promise<number | null> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;

  // Search EVERY recorded spelling, not just the display name — a source that
  // writes "DORN BRACHT" must resolve to Dornbracht rather than fork a new brand.
  const knownId = await findBrandIdByAnyName(db, trimmed);
  if (knownId !== null) return knownId;

  try {
    const [created] = await db.insert(brands).values({ name: trimmed }).returning();
    // Record the spelling as this brand's primary so later scrapes that use the
    // same wording resolve to it instead of forking a new brand.
    await setPrimaryBrandName(db, created.id, trimmed);
    return created.id;
  } catch {
    // A concurrent ingest created the same brand between our select and insert —
    // re-select instead of failing on the unique-name violation.
    const [row] = await db
      .select()
      .from(brands)
      .where(eq(sql`lower(${brands.name})`, trimmed.toLowerCase()))
      .limit(1);
    if (row) return row.id;
    throw new Error(`brand resolve failed for "${trimmed}"`);
  }
}

/**
 * Load the live config vocabulary (0020-C2) to inject into the AI extraction
 * prompt — active category names, active colors (id/name/hexCode), and brand
 * names.
 */
export async function loadExtractionVocab(db: Db): Promise<ExtractionVocabContext> {
  const [categoryRows, colorRows, brandRows] = await Promise.all([
    db.select({ name: categories.name }).from(categories).where(eq(categories.isActive, true)),
    db
      .select({ id: colors.id, name: colors.name, hexCode: colors.hexCode })
      .from(colors)
      .where(eq(colors.isActive, true)),
    db.select({ name: brands.name }).from(brands),
  ]);

  return {
    categories: categoryRows.map((r) => r.name),
    colors: colorRows,
    brands: brandRows.map((r) => r.name),
  };
}

/**
 * Case-insensitive lookup of an active category by name. Does NOT create — see
 * the doc on this same function in the original product-photos.ts location for
 * why (AI-creates-"Other" is a colors-only behavior, not categories).
 */
export async function resolveCategoryId(db: Db, name: string | null | undefined): Promise<number | null> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;

  const [existing] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(sql`lower(${categories.name})`, trimmed.toLowerCase()), eq(categories.isActive, true)))
    .limit(1);
  return existing?.id ?? null;
}

/**
 * Find-or-create a color by case-insensitive name — the AI-creates-"Other"
 * path for the `colors` config vocabulary (AGENTS.md "Multi-select &
 * config-driven definitions").
 */
export async function resolveOrCreateColorId(db: Db, name: string, hexCode: string | null | undefined): Promise<number> {
  const trimmed = name.trim();
  const [existing] = await db
    .select({ id: colors.id })
    .from(colors)
    .where(eq(sql`lower(${colors.name})`, trimmed.toLowerCase()))
    .limit(1);
  if (existing) return existing.id;

  try {
    const [created] = await db.insert(colors).values({ name: trimmed, hexCode: hexCode ?? null }).returning();
    return created.id;
  } catch {
    // Concurrent ingest created the same color between our select and insert.
    const [row] = await db
      .select({ id: colors.id })
      .from(colors)
      .where(eq(sql`lower(${colors.name})`, trimmed.toLowerCase()))
      .limit(1);
    if (row) return row.id;
    throw new Error(`color resolve failed for "${trimmed}"`);
  }
}

/**
 * Find-or-create the product this extraction depicts:
 *   1. (brandId, modelKey) — the canonical unique index — when both are known.
 *   2. (brandId, case-insensitive itemName) fallback.
 *   3. Otherwise create a new product from the AI attributes; auto-created rows
 *      are expected to be confirmed/corrected via HITL review.
 */
export async function ensureProductFromExtraction(db: Db, attrs: ProductExtraction) {
  const brandId = await resolveBrandId(db, attrs.brand);
  const modelKey = normalizeModelKey(attrs.modelNumber);
  const itemName = (attrs.itemName ?? "").trim();

  let found: typeof showroomStoreProducts.$inferSelect | undefined;

  if (brandId != null && modelKey != null) {
    [found] = await db
      .select()
      .from(showroomStoreProducts)
      .where(and(eq(showroomStoreProducts.brandId, brandId), eq(showroomStoreProducts.modelKey, modelKey)))
      .limit(1);
  }

  if (!found && brandId != null && itemName) {
    [found] = await db
      .select()
      .from(showroomStoreProducts)
      .where(
        and(
          eq(showroomStoreProducts.brandId, brandId),
          eq(sql`lower(${showroomStoreProducts.itemName})`, itemName.toLowerCase()),
        ),
      )
      .limit(1);
  }

  if (found) return { created: false, product: found };

  try {
    const [created] = await db
      .insert(showroomStoreProducts)
      .values({
        itemName: itemName || "Unnamed",
        brandId,
        modelNumber: attrs.modelNumber ?? null,
        modelKey,
        colors: attrs.colors && attrs.colors.length > 0 ? attrs.colors.map((c) => c.name).join(", ") : null,
        productType: attrs.category ?? null,
      })
      .returning();
    return { created: true, product: created };
  } catch {
    // A concurrent ingest created the same (brandId, modelKey) product — re-select
    // instead of failing on the unique-index violation.
    if (brandId != null && modelKey != null) {
      const [row] = await db
        .select()
        .from(showroomStoreProducts)
        .where(and(eq(showroomStoreProducts.brandId, brandId), eq(showroomStoreProducts.modelKey, modelKey)))
        .limit(1);
      if (row) return { created: false, product: row };
    }
    throw new Error("product resolve failed after concurrent insert");
  }
}
