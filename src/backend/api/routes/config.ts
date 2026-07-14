// src/backend/api/routes/config.ts
/**
 * @fileoverview Config-driven vocabulary API (0020-C2).
 *
 * Implements the AGENTS.md "Multi-select & config-driven definitions" contract
 * for the three shared vocabularies (`categories`, `subcategories`, `colors`)
 * plus the five owner<->definition mapping tables that reuse them
 * (`photo_categories`, `photo_subcategories`, `photo_colors`,
 * `brand_categories`, `product_categories`).
 *
 *   Definitions (list active / create-"Other" / soft-update):
 *     GET   /categories                  GET   /subcategories?categoryId=   GET   /colors
 *     POST  /categories                  POST  /subcategories               POST  /colors
 *     PATCH /categories/:id              PATCH /subcategories/:id           PATCH /colors/:id
 *
 *   Mappings (replace-semantics per owning row):
 *     GET/PUT /photos/:photoId/categories
 *     GET/PUT /photos/:photoId/subcategories
 *     GET/PUT /photos/:photoId/colors
 *     GET/PUT /brands/:brandId/categories
 *     GET/PUT /products/:productId/categories
 *
 *   Phase-3 review-form vocab:
 *     GET  /brands?categoryId=          POST /brands
 *     GET  /styles?categoryId=
 *
 * Mounts at /api/config (wired in api/index.ts), behind requireAccessAuth.
 * Plain Hono + hand-written Zod v4 (drizzle-zod is banned — breaks the build,
 * see products-catalog.ts / showroom-products.ts for the established pattern
 * this file mirrors).
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, eq, asc, sql } from "drizzle-orm";
import { z } from "zod";

import {
  categories,
  subcategories,
  colors,
  photoCategories,
  photoSubcategories,
  photoColors,
  brandCategories,
  productCategories,
  brands,
  productShowroomPhotos,
  productPhotoBuckets,
} from "@backend/db";
import { resolveBrandId } from "@backend/services/image-processor/intake-helpers";

export const configRouter = new Hono<{ Bindings: Env }>();

type Db = ReturnType<typeof drizzle>;

// ─── Shared helpers ─────────────────────────────────────────────────────────

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });
const mappingIdsSchema = z.object({ ids: z.array(z.number().int().positive()) });

function badRequest(c: { json: (body: unknown, status: 400) => Response }, message: string, details?: unknown) {
  return c.json({ error: { code: "bad_request", message, details } }, 400);
}

/**
 * Replace-semantics mapping write: delete every existing `(ownerCol = ownerId)`
 * row from `mapTable`, then (if `defIds` is non-empty) batch-insert the given
 * ids via `buildRow`. Runs as a single `db.batch` so the delete+insert pair is
 * atomic. De-dupes `defIds` — the unique index on the mapping table would
 * otherwise reject repeats.
 */
export async function replaceMapping(
  db: Db,
  mapTable: any,
  ownerCol: any,
  ownerId: number,
  defIds: number[],
  buildRow: (defId: number) => Record<string, unknown>,
): Promise<number[]> {
  const uniqueIds = [...new Set(defIds)];
  if (uniqueIds.length === 0) {
    await db.delete(mapTable).where(eq(ownerCol, ownerId));
    return [];
  }
  const stmts = [
    db.delete(mapTable).where(eq(ownerCol, ownerId)),
    db.insert(mapTable).values(uniqueIds.map(buildRow)),
  ];
  await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  return uniqueIds;
}

// ─── CATEGORIES ─────────────────────────────────────────────────────────────

const createCategorySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional().nullable(),
});
const updateCategorySchema = createCategorySchema.partial().extend({
  isActive: z.boolean().optional(),
});

/** GET /categories — active categories, alphabetical (feeds the multi-select). */
configRouter.get("/categories", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(categories).where(eq(categories.isActive, true)).orderBy(asc(categories.name));
  return c.json({ categories: rows });
});

/** POST /categories — the "Other" create path. Returns the new definition row. */
configRouter.post("/categories", async (c) => {
  const parsed = createCategorySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return badRequest(c, "Invalid category body", parsed.error.flatten());

  const db = drizzle(c.env.DB);
  const [created] = await db.insert(categories).values(parsed.data).returning();
  return c.json({ category: created }, 201);
});

/** PATCH /categories/:id — edit name/description or soft-deactivate. */
configRouter.patch("/categories/:id", async (c) => {
  const idParsed = idParamSchema.safeParse(c.req.param());
  if (!idParsed.success) return badRequest(c, "Invalid category id");
  const bodyParsed = updateCategorySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!bodyParsed.success) return badRequest(c, "Invalid category body", bodyParsed.error.flatten());
  if (Object.keys(bodyParsed.data).length === 0) return badRequest(c, "No fields to update");

  const db = drizzle(c.env.DB);
  const [updated] = await db
    .update(categories)
    .set(bodyParsed.data)
    .where(eq(categories.id, idParsed.data.id))
    .returning();
  if (!updated) return c.json({ error: { code: "not_found", message: "Category not found" } }, 404);
  return c.json({ category: updated });
});

// ─── SUBCATEGORIES ──────────────────────────────────────────────────────────

const subcategoryQuerySchema = z.object({ categoryId: z.coerce.number().int().positive().optional() });
const createSubcategorySchema = z.object({
  name: z.string().min(1),
  categoryId: z.number().int().positive(),
  description: z.string().min(1).optional().nullable(),
});
const updateSubcategorySchema = createSubcategorySchema.partial().extend({
  isActive: z.boolean().optional(),
});

/** GET /subcategories?categoryId= — active subcategories, optionally scoped to a parent category. */
configRouter.get("/subcategories", async (c) => {
  const parsed = subcategoryQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return badRequest(c, "Invalid query params", parsed.error.flatten());

  const db = drizzle(c.env.DB);
  const conditions = [eq(subcategories.isActive, true)];
  if (parsed.data.categoryId != null) conditions.push(eq(subcategories.categoryId, parsed.data.categoryId));

  const rows = await db.select().from(subcategories).where(and(...conditions)).orderBy(asc(subcategories.name));
  return c.json({ subcategories: rows });
});

/** POST /subcategories — the "Other" create path (requires a parent categoryId). */
configRouter.post("/subcategories", async (c) => {
  const parsed = createSubcategorySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return badRequest(c, "Invalid subcategory body", parsed.error.flatten());

  const db = drizzle(c.env.DB);
  try {
    const [created] = await db.insert(subcategories).values(parsed.data).returning();
    return c.json({ subcategory: created }, 201);
  } catch (err) {
    // FK violation — the given categoryId doesn't exist.
    return badRequest(c, "categoryId does not reference an existing category", err instanceof Error ? err.message : undefined);
  }
});

/** PATCH /subcategories/:id — edit name/description/parent category or soft-deactivate. */
configRouter.patch("/subcategories/:id", async (c) => {
  const idParsed = idParamSchema.safeParse(c.req.param());
  if (!idParsed.success) return badRequest(c, "Invalid subcategory id");
  const bodyParsed = updateSubcategorySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!bodyParsed.success) return badRequest(c, "Invalid subcategory body", bodyParsed.error.flatten());
  if (Object.keys(bodyParsed.data).length === 0) return badRequest(c, "No fields to update");

  const db = drizzle(c.env.DB);
  const [updated] = await db
    .update(subcategories)
    .set(bodyParsed.data)
    .where(eq(subcategories.id, idParsed.data.id))
    .returning();
  if (!updated) return c.json({ error: { code: "not_found", message: "Subcategory not found" } }, 404);
  return c.json({ subcategory: updated });
});

// ─── COLORS ─────────────────────────────────────────────────────────────────

const createColorSchema = z.object({
  name: z.string().min(1),
  hexCode: z.string().min(1).optional().nullable(),
  description: z.string().min(1).optional().nullable(),
});
const updateColorSchema = createColorSchema.partial().extend({
  isActive: z.boolean().optional(),
});

/** GET /colors — active colors, alphabetical (feeds the multi-select + swatches). */
configRouter.get("/colors", async (c) => {
  const db = drizzle(c.env.DB);
  const rows = await db.select().from(colors).where(eq(colors.isActive, true)).orderBy(asc(colors.name));
  return c.json({ colors: rows });
});

/** POST /colors — the "Other" create path (name + optional hex swatch). */
configRouter.post("/colors", async (c) => {
  const parsed = createColorSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return badRequest(c, "Invalid color body", parsed.error.flatten());

  const db = drizzle(c.env.DB);
  const [created] = await db.insert(colors).values(parsed.data).returning();
  return c.json({ color: created }, 201);
});

/** PATCH /colors/:id — edit name/hex/description or soft-deactivate. */
configRouter.patch("/colors/:id", async (c) => {
  const idParsed = idParamSchema.safeParse(c.req.param());
  if (!idParsed.success) return badRequest(c, "Invalid color id");
  const bodyParsed = updateColorSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!bodyParsed.success) return badRequest(c, "Invalid color body", bodyParsed.error.flatten());
  if (Object.keys(bodyParsed.data).length === 0) return badRequest(c, "No fields to update");

  const db = drizzle(c.env.DB);
  const [updated] = await db.update(colors).set(bodyParsed.data).where(eq(colors.id, idParsed.data.id)).returning();
  if (!updated) return c.json({ error: { code: "not_found", message: "Color not found" } }, 404);
  return c.json({ color: updated });
});

// ─── BRANDS (Phase 3 review form) ──────────────────────────────────────────

const brandsQuerySchema = z.object({ categoryId: z.coerce.number().int().positive().optional() });
const createBrandSchema = z.object({
  name: z.string().min(1),
  categoryId: z.number().int().positive().optional(),
});

/**
 * GET /brands?categoryId= — brand picker for the review form. `brands` has no
 * `isActive` column (unlike categories/subcategories/colors), so every row is
 * eligible; when `categoryId` is given, scope to brands mapped via
 * `brand_categories` (the Phase-1 mapping table).
 */
configRouter.get("/brands", async (c) => {
  const parsed = brandsQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return badRequest(c, "Invalid query params", parsed.error.flatten());

  const db = drizzle(c.env.DB);
  if (parsed.data.categoryId != null) {
    const rows = await db
      .select({ id: brands.id, name: brands.name })
      .from(brands)
      .innerJoin(brandCategories, eq(brandCategories.brandId, brands.id))
      .where(eq(brandCategories.categoryId, parsed.data.categoryId))
      .orderBy(asc(brands.name));
    return c.json({ brands: rows });
  }

  const rows = await db.select({ id: brands.id, name: brands.name }).from(brands).orderBy(asc(brands.name));
  return c.json({ brands: rows });
});

/**
 * POST /brands — the review form's "Other" brand create path. Reuses
 * `resolveBrandId` (case-insensitive find-or-create) so a brand typed here
 * never diverges from the one an AI extraction would resolve to. Optionally
 * maps the new brand to a category in the same request.
 */
configRouter.post("/brands", async (c) => {
  const parsed = createBrandSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return badRequest(c, "Invalid brand body", parsed.error.flatten());

  const db = drizzle(c.env.DB);
  const brandId = await resolveBrandId(db, parsed.data.name);
  if (brandId == null) return badRequest(c, "Invalid brand name");

  if (parsed.data.categoryId != null) {
    await db.insert(brandCategories).values({ brandId, categoryId: parsed.data.categoryId }).onConflictDoNothing();
  }

  const [brand] = await db.select({ id: brands.id, name: brands.name }).from(brands).where(eq(brands.id, brandId)).limit(1);
  return c.json({ brand }, 201);
});

// ─── STYLES (Phase 3 review form) ──────────────────────────────────────────

const stylesQuerySchema = z.object({ categoryId: z.coerce.number().int().positive().optional() });

/**
 * GET /styles?categoryId= — free-text style autocomplete for the review form.
 * `showroom_store_products` has no `style` column (checked: it doesn't exist),
 * so styles are sourced from `product_showroom_photos.attributes->>'style'`
 * (the AI extraction seed, corrected by the reviewer) on REVIEWED buckets only
 * — draft/processed-but-unreviewed style guesses aren't offered as vocabulary.
 * Lowercase-deduped (first-seen casing wins), capped at 100, alphabetical.
 */
configRouter.get("/styles", async (c) => {
  const parsed = stylesQuerySchema.safeParse(c.req.query());
  if (!parsed.success) return badRequest(c, "Invalid query params", parsed.error.flatten());

  const db = drizzle(c.env.DB);
  const styleExpr = sql<string>`json_extract(${productShowroomPhotos.attributes}, '$.style')`;
  const conditions = [
    eq(productPhotoBuckets.status, "reviewed"),
    sql`${styleExpr} is not null`,
    sql`trim(${styleExpr}) != ''`,
  ];
  if (parsed.data.categoryId != null) conditions.push(eq(photoCategories.categoryId, parsed.data.categoryId));

  const rows = await db
    .selectDistinct({ style: styleExpr })
    .from(productShowroomPhotos)
    .innerJoin(productPhotoBuckets, eq(productShowroomPhotos.bucketId, productPhotoBuckets.id))
    .leftJoin(photoCategories, eq(photoCategories.photoId, productShowroomPhotos.id))
    .where(and(...conditions))
    .orderBy(asc(styleExpr));

  const seen = new Map<string, string>();
  for (const row of rows) {
    const value = (row.style ?? "").trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (!seen.has(key)) seen.set(key, value);
  }
  return c.json({ styles: [...seen.values()].slice(0, 100) });
});

// ─── MAPPINGS ───────────────────────────────────────────────────────────────

const ownerIdParamSchema = <K extends string>(key: K) => z.object({ [key]: z.coerce.number().int().positive() } as Record<K, z.ZodNumber>);

/** photos <-> categories */
configRouter.get("/photos/:photoId/categories", async (c) => {
  const parsed = ownerIdParamSchema("photoId").safeParse(c.req.param());
  if (!parsed.success) return badRequest(c, "Invalid photoId");
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ id: categories.id, name: categories.name, description: categories.description })
    .from(photoCategories)
    .innerJoin(categories, eq(photoCategories.categoryId, categories.id))
    .where(eq(photoCategories.photoId, parsed.data.photoId))
    .orderBy(asc(categories.name));
  return c.json({ categories: rows });
});
configRouter.put("/photos/:photoId/categories", async (c) => {
  const paramParsed = ownerIdParamSchema("photoId").safeParse(c.req.param());
  if (!paramParsed.success) return badRequest(c, "Invalid photoId");
  const bodyParsed = mappingIdsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!bodyParsed.success) return badRequest(c, "Invalid body — expected { ids: number[] }", bodyParsed.error.flatten());

  const db = drizzle(c.env.DB);
  const { photoId } = paramParsed.data;
  const ids = await replaceMapping(db, photoCategories, photoCategories.photoId, photoId, bodyParsed.data.ids, (categoryId) => ({
    photoId,
    categoryId,
  }));
  return c.json({ photoId, categoryIds: ids });
});

/** photos <-> subcategories */
configRouter.get("/photos/:photoId/subcategories", async (c) => {
  const parsed = ownerIdParamSchema("photoId").safeParse(c.req.param());
  if (!parsed.success) return badRequest(c, "Invalid photoId");
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ id: subcategories.id, name: subcategories.name, categoryId: subcategories.categoryId })
    .from(photoSubcategories)
    .innerJoin(subcategories, eq(photoSubcategories.subcategoryId, subcategories.id))
    .where(eq(photoSubcategories.photoId, parsed.data.photoId))
    .orderBy(asc(subcategories.name));
  return c.json({ subcategories: rows });
});
configRouter.put("/photos/:photoId/subcategories", async (c) => {
  const paramParsed = ownerIdParamSchema("photoId").safeParse(c.req.param());
  if (!paramParsed.success) return badRequest(c, "Invalid photoId");
  const bodyParsed = mappingIdsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!bodyParsed.success) return badRequest(c, "Invalid body — expected { ids: number[] }", bodyParsed.error.flatten());

  const db = drizzle(c.env.DB);
  const { photoId } = paramParsed.data;
  const ids = await replaceMapping(
    db,
    photoSubcategories,
    photoSubcategories.photoId,
    photoId,
    bodyParsed.data.ids,
    (subcategoryId) => ({ photoId, subcategoryId }),
  );
  return c.json({ photoId, subcategoryIds: ids });
});

/** photos <-> colors */
configRouter.get("/photos/:photoId/colors", async (c) => {
  const parsed = ownerIdParamSchema("photoId").safeParse(c.req.param());
  if (!parsed.success) return badRequest(c, "Invalid photoId");
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ id: colors.id, name: colors.name, hexCode: colors.hexCode })
    .from(photoColors)
    .innerJoin(colors, eq(photoColors.colorId, colors.id))
    .where(eq(photoColors.photoId, parsed.data.photoId))
    .orderBy(asc(colors.name));
  return c.json({ colors: rows });
});
configRouter.put("/photos/:photoId/colors", async (c) => {
  const paramParsed = ownerIdParamSchema("photoId").safeParse(c.req.param());
  if (!paramParsed.success) return badRequest(c, "Invalid photoId");
  const bodyParsed = mappingIdsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!bodyParsed.success) return badRequest(c, "Invalid body — expected { ids: number[] }", bodyParsed.error.flatten());

  const db = drizzle(c.env.DB);
  const { photoId } = paramParsed.data;
  const ids = await replaceMapping(db, photoColors, photoColors.photoId, photoId, bodyParsed.data.ids, (colorId) => ({
    photoId,
    colorId,
  }));
  return c.json({ photoId, colorIds: ids });
});

/** brands <-> categories */
configRouter.get("/brands/:brandId/categories", async (c) => {
  const parsed = ownerIdParamSchema("brandId").safeParse(c.req.param());
  if (!parsed.success) return badRequest(c, "Invalid brandId");
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ id: categories.id, name: categories.name, description: categories.description })
    .from(brandCategories)
    .innerJoin(categories, eq(brandCategories.categoryId, categories.id))
    .where(eq(brandCategories.brandId, parsed.data.brandId))
    .orderBy(asc(categories.name));
  return c.json({ categories: rows });
});
configRouter.put("/brands/:brandId/categories", async (c) => {
  const paramParsed = ownerIdParamSchema("brandId").safeParse(c.req.param());
  if (!paramParsed.success) return badRequest(c, "Invalid brandId");
  const bodyParsed = mappingIdsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!bodyParsed.success) return badRequest(c, "Invalid body — expected { ids: number[] }", bodyParsed.error.flatten());

  const db = drizzle(c.env.DB);
  const { brandId } = paramParsed.data;
  const ids = await replaceMapping(db, brandCategories, brandCategories.brandId, brandId, bodyParsed.data.ids, (categoryId) => ({
    brandId,
    categoryId,
  }));
  return c.json({ brandId, categoryIds: ids });
});

/** products <-> categories */
configRouter.get("/products/:productId/categories", async (c) => {
  const parsed = ownerIdParamSchema("productId").safeParse(c.req.param());
  if (!parsed.success) return badRequest(c, "Invalid productId");
  const db = drizzle(c.env.DB);
  const rows = await db
    .select({ id: categories.id, name: categories.name, description: categories.description })
    .from(productCategories)
    .innerJoin(categories, eq(productCategories.categoryId, categories.id))
    .where(eq(productCategories.productId, parsed.data.productId))
    .orderBy(asc(categories.name));
  return c.json({ categories: rows });
});
configRouter.put("/products/:productId/categories", async (c) => {
  const paramParsed = ownerIdParamSchema("productId").safeParse(c.req.param());
  if (!paramParsed.success) return badRequest(c, "Invalid productId");
  const bodyParsed = mappingIdsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!bodyParsed.success) return badRequest(c, "Invalid body — expected { ids: number[] }", bodyParsed.error.flatten());

  const db = drizzle(c.env.DB);
  const { productId } = paramParsed.data;
  const ids = await replaceMapping(
    db,
    productCategories,
    productCategories.productId,
    productId,
    bodyParsed.data.ids,
    (categoryId) => ({ productId, categoryId }),
  );
  return c.json({ productId, categoryIds: ids });
});
