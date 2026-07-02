/**
 * @fileoverview Brands API
 *
 * CRUD for brands, brand-type definitions, and brand-type mappings.
 * Mounts at /api/brands (see src/backend/api/index.ts).
 *
 * Tables touched:
 *   - brands                  — top-level brand registry
 *   - brand_types_def         — reference list of brand classifications
 *   - brand_type_mappings     — many-to-many brand ↔ type
 *   - showroom_brand_mappings — resolved via showroom-stores.ts (read here for brand detail)
 *
 * Conventions:
 *   - Hand-written Zod v4 schemas (drizzle-zod is banned — breaks pnpm run build).
 *   - `drizzle(c.env.DB)` for every DB client — no global mutable state.
 *   - `c.executionCtx.waitUntil(...)` for fire-and-forget favicon hydration.
 *   - Core list + create routes use zod-openapi `createRoute`; lighter sub-routes
 *     use plain `.get/.post/...` to keep boilerplate proportional.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { eq, and, inArray, like } from "drizzle-orm";

import { brands } from "@backend/db/schema/brands/brands";
import { brandTypesDef } from "@backend/db/schema/brands/brand_types_def";
import { brandTypeMappings } from "@backend/db/schema/brands/brand_type_mappings";
import { showroomBrandMappings } from "@backend/db/schema/brands/showroom_brand_mappings";
import { faviconService } from "@backend/services/favicon";

export const brandsRouter = new OpenAPIHono<{ Bindings: Env }>();

// ─── Shared error envelope ────────────────────────────────────────────────────

const errorSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

// ─── Param schemas ────────────────────────────────────────────────────────────

const brandIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
});

const typeIdParamSchema = z.object({
  typeId: z.string().regex(/^\d+$/).transform(Number),
});

const brandTypeIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
  typeId: z.string().regex(/^\d+$/).transform(Number),
});

// ─── Request body schemas ─────────────────────────────────────────────────────

/**
 * Schema for creating a brand type definition.
 * `isActive` defaults to true when omitted.
 */
const createBrandTypeSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

/**
 * Schema for creating a brand.
 *
 * `typeIds` is virtual — not a DB column. Rows are inserted into
 * `brand_type_mappings` after the brand is persisted, then stripped.
 */
const createBrandSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  websiteUrl: z.string().optional().nullable(),
  instagramUrl: z.string().optional().nullable(),
  /** Optional list of `brand_types_def.id` values to attach on creation. */
  typeIds: z.array(z.number().int().positive()).optional().default([]),
});

/** Body for the brand-type add sub-route. */
const addBrandTypeSchema = z.object({
  typeId: z.number().int().positive(),
});

// ─── OpenAPI response schemas ─────────────────────────────────────────────────

/**
 * Lean brand shape returned in list endpoints.
 * Matches `brands.$inferSelect` column set — hand-written to avoid drizzle-zod.
 * Timestamps are `Date | null` because Drizzle maps integer timestamp columns
 * with mode:"timestamp" to Date objects at the ORM layer.
 */
const brandSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  websiteUrl: z.string().nullable(),
  instagramUrl: z.string().nullable(),
  iconCfImagesUrl: z.string().nullable(),
  createdAt: z.union([z.date(), z.number()]).nullable(),
  updatedAt: z.union([z.date(), z.number()]).nullable(),
});

const brandTypeDefSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.union([z.date(), z.number()]).nullable(),
});

// ─── BRAND TYPE DEFS ──────────────────────────────────────────────────────────

/**
 * GET /types — list all brand type definitions.
 * Optional query: `?activeOnly=true` to filter inactive types out.
 */
brandsRouter.openapi(
  createRoute({
    method: "get",
    path: "/types",
    operationId: "listBrandTypes",
    tags: ["Brands"],
    summary: "List all brand type definitions",
    request: {
      query: z.object({
        activeOnly: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: "Brand type definitions",
        content: {
          "application/json": {
            schema: z.object({ types: z.array(brandTypeDefSchema) }),
          },
        },
      },
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const activeOnly = c.req.valid("query").activeOnly === "true";

    const rows = activeOnly
      ? await db.select().from(brandTypesDef).where(eq(brandTypesDef.isActive, true))
      : await db.select().from(brandTypesDef);

    return c.json({ types: rows });
  },
);

/**
 * POST /types — create a brand type definition.
 */
brandsRouter.post("/types", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json();
  const parsed = createBrandTypeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  const [inserted] = await db.insert(brandTypesDef).values(parsed.data).returning();
  return c.json({ type: inserted }, 201);
});

/**
 * PUT /types/:typeId — update a brand type definition (name / description / isActive).
 */
brandsRouter.put("/types/:typeId", async (c) => {
  const db = drizzle(c.env.DB);
  const typeId = Number(c.req.param("typeId"));
  if (!Number.isInteger(typeId)) {
    return c.json({ success: false, error: "Invalid typeId" }, 400);
  }

  const body = await c.req.json();
  const parsed = createBrandTypeSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  const [updated] = await db
    .update(brandTypesDef)
    .set(parsed.data as Partial<typeof brandTypesDef.$inferInsert>)
    .where(eq(brandTypesDef.id, typeId))
    .returning();

  if (!updated) return c.json({ success: false, error: "Type not found" }, 404);
  return c.json({ type: updated });
});

/**
 * DELETE /types/:typeId — hard-delete a brand type definition.
 * Cascades to `brand_type_mappings` rows via FK cascade.
 */
brandsRouter.delete("/types/:typeId", async (c) => {
  const db = drizzle(c.env.DB);
  const typeId = Number(c.req.param("typeId"));
  if (!Number.isInteger(typeId)) {
    return c.json({ success: false, error: "Invalid typeId" }, 400);
  }

  await db.delete(brandTypesDef).where(eq(brandTypesDef.id, typeId));
  return c.json({ success: true });
});

// ─── BRANDS CRUD ──────────────────────────────────────────────────────────────

/**
 * GET / — list all brands, with optional autocomplete search.
 *
 * Query params:
 *   `?search=<q>`    — filter brands whose name contains `q` (case-insensitive,
 *                       SQLite LIKE), max 20 results, ordered by name.
 *                       When omitted, returns the full list (no limit applied).
 *   `?include=types` — attach each brand's type mappings (joined with brand_types_def).
 *                       Compatible with `?search=`.
 *
 * `iconCfImagesUrl` and `instagramUrl` are always included in every response.
 */
brandsRouter.openapi(
  createRoute({
    method: "get",
    path: "/",
    operationId: "listBrands",
    tags: ["Brands"],
    summary: "List all brands (supports ?search= autocomplete)",
    request: {
      query: z.object({
        include: z.string().optional(),
        /** Partial name match for autocomplete — max 20 results returned. */
        search: z.string().min(1).optional(),
      }),
    },
    responses: {
      200: {
        description: "Brand list",
        content: {
          "application/json": {
            schema: z.object({ brands: z.array(brandSchema) }),
          },
        },
      },
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const { include: includeParam = "", search } = c.req.valid("query");
    const includes = new Set(includeParam.split(",").map((s) => s.trim()).filter(Boolean));

    // Build the base query.  When `search` is present, apply a LIKE filter and
    // cap results at 20.  SQLite LIKE is case-insensitive for ASCII characters
    // by default, which is sufficient for brand name matching.
    let brandRows: (typeof brands.$inferSelect)[];
    if (search && search.length > 0) {
      brandRows = await db
        .select()
        .from(brands)
        .where(like(brands.name, `%${search}%`))
        .orderBy(brands.name)
        .limit(20);
    } else {
      brandRows = await db.select().from(brands).orderBy(brands.name);
    }

    if (!includes.has("types") || brandRows.length === 0) {
      return c.json({ brands: brandRows });
    }

    // Fetch type mappings for all brands in one query.
    // brandRows.length > 0 is guaranteed by the early-return above.
    const brandIds = brandRows.map((b) => b.id) as [number, ...number[]];
    const typeMappingRows = await db
      .select({
        brandId: brandTypeMappings.brandId,
        typeId: brandTypesDef.id,
        typeName: brandTypesDef.name,
      })
      .from(brandTypeMappings)
      .innerJoin(brandTypesDef, eq(brandTypeMappings.typeId, brandTypesDef.id))
      .where(inArray(brandTypeMappings.brandId, brandIds));

    // Build a map brandId → types[].
    const typesMap = new Map<number, { typeId: number; name: string }[]>();
    for (const r of typeMappingRows) {
      const list = typesMap.get(r.brandId) ?? [];
      list.push({ typeId: r.typeId, name: r.typeName });
      typesMap.set(r.brandId, list);
    }

    const enriched = brandRows.map((b) => ({
      ...b,
      types: typesMap.get(b.id) ?? [],
    }));

    return c.json({ brands: enriched });
  },
);

/**
 * GET /:id — brand detail with type mappings and showroom locations that carry it.
 */
brandsRouter.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const brandId = Number(c.req.param("id"));
  if (!Number.isInteger(brandId)) {
    return c.json({ success: false, error: "Invalid brand id" }, 400);
  }

  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
  if (!brand) return c.json({ success: false, error: "Brand not found" }, 404);

  const [typeMappingRows, showroomRows] = await Promise.all([
    db
      .select({
        mappingId: brandTypeMappings.id,
        typeId: brandTypesDef.id,
        typeName: brandTypesDef.name,
        typeDescription: brandTypesDef.description,
        brandIconCfImagesUrl: brandTypeMappings.brandIconCfImagesUrl,
      })
      .from(brandTypeMappings)
      .innerJoin(brandTypesDef, eq(brandTypeMappings.typeId, brandTypesDef.id))
      .where(eq(brandTypeMappings.brandId, brandId)),
    db
      .select({
        mappingId: showroomBrandMappings.id,
        showroomId: showroomBrandMappings.showroomId,
        createdAt: showroomBrandMappings.createdAt,
      })
      .from(showroomBrandMappings)
      .where(eq(showroomBrandMappings.brandId, brandId)),
  ]);

  return c.json({
    brand,
    types: typeMappingRows,
    showrooms: showroomRows,
  });
});

/**
 * POST / — create a brand.
 *
 * Body: `createBrandSchema` — `typeIds` is virtual (inserted into brand_type_mappings).
 * After insert, if `websiteUrl` is set, fires favicon hydration in background.
 */
brandsRouter.openapi(
  createRoute({
    method: "post",
    path: "/",
    operationId: "createBrand",
    tags: ["Brands"],
    summary: "Create a new brand",
    request: {
      body: {
        required: true,
        content: {
          "application/json": {
            schema: createBrandSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: "Brand created",
        content: {
          "application/json": {
            schema: z.object({ brand: brandSchema }),
          },
        },
      },
      400: {
        description: "Validation error",
        content: { "application/json": { schema: errorSchema } },
      },
      500: {
        description: "Server error",
        content: { "application/json": { schema: errorSchema } },
      },
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const body = c.req.valid("json");

    const { typeIds, ...brandValues } = body;

    try {
      const [inserted] = await db.insert(brands).values(brandValues).returning();

      // Insert brand type mappings when typeIds provided — dedupe + batch.
      if (typeIds && typeIds.length > 0) {
        const uniqueTypeIds = [...new Set(typeIds)];
        const BATCH_SIZE = 50;
        for (let i = 0; i < uniqueTypeIds.length; i += BATCH_SIZE) {
          const chunk = uniqueTypeIds.slice(i, i + BATCH_SIZE);
          const stmts = chunk.map((typeId) =>
            db.insert(brandTypeMappings).values({ brandId: inserted.id, typeId }),
          );
          await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
        }
      }

      // Fire favicon hydration in the background if websiteUrl is set.
      if (inserted.websiteUrl && inserted.websiteUrl.length > 0) {
        c.executionCtx.waitUntil(
          faviconService.hydrateBrandIcon(c.env, inserted.id, inserted.websiteUrl),
        );
      }

      return c.json({ brand: inserted }, 201);
    } catch (err: any) {
      console.error("[brands] POST / error:", err);
      return c.json({ success: false as const, error: "Failed to create brand" }, 500);
    }
  },
);

/**
 * PUT /:id — update brand fields.
 *
 * If `websiteUrl` is present in the body AND differs from the stored value
 * (or the brand has no icon yet), triggers a favicon re-hydration in background.
 */
brandsRouter.put("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const brandId = Number(c.req.param("id"));
  if (!Number.isInteger(brandId)) {
    return c.json({ success: false, error: "Invalid brand id" }, 400);
  }

  const body = await c.req.json();
  const parsed = createBrandSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  // Fetch existing row to compare websiteUrl + icon.
  const [existing] = await db
    .select({ websiteUrl: brands.websiteUrl, iconCfImagesUrl: brands.iconCfImagesUrl })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  if (!existing) return c.json({ success: false, error: "Brand not found" }, 404);

  const { typeIds: _typeIds, ...updateValues } = parsed.data;

  const [updated] = await db
    .update(brands)
    .set({ ...updateValues, updatedAt: new Date() } as Partial<typeof brands.$inferInsert>)
    .where(eq(brands.id, brandId))
    .returning();

  if (!updated) return c.json({ success: false, error: "Brand not found" }, 404);

  // Trigger favicon refresh when websiteUrl changed or icon is missing.
  const incomingUrl = updateValues.websiteUrl ?? null;
  const shouldRefreshIcon =
    incomingUrl &&
    incomingUrl.length > 0 &&
    (incomingUrl !== existing.websiteUrl || !existing.iconCfImagesUrl);

  if (shouldRefreshIcon) {
    c.executionCtx.waitUntil(
      faviconService.hydrateBrandIcon(c.env, brandId, incomingUrl),
    );
  }

  return c.json({ brand: updated });
});

/**
 * DELETE /:id — hard-delete a brand.
 * Cascades to `brand_type_mappings` and `showroom_brand_mappings` via FK cascade.
 */
brandsRouter.delete("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const brandId = Number(c.req.param("id"));
  if (!Number.isInteger(brandId)) {
    return c.json({ success: false, error: "Invalid brand id" }, 400);
  }

  await db.delete(brands).where(eq(brands.id, brandId));
  return c.json({ success: true });
});

// ─── BRAND ↔ TYPE MAPPINGS ────────────────────────────────────────────────────

/**
 * POST /:id/types — add a type mapping to a brand.
 *
 * Body: { typeId: number }
 * Duplicate (brandId, typeId) pairs are silently tolerated.
 */
brandsRouter.post("/:id/types", async (c) => {
  const db = drizzle(c.env.DB);
  const brandId = Number(c.req.param("id"));
  if (!Number.isInteger(brandId)) {
    return c.json({ success: false, error: "Invalid brand id" }, 400);
  }

  const body = await c.req.json();
  const parsed = addBrandTypeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  try {
    const [inserted] = await db
      .insert(brandTypeMappings)
      .values({ brandId, typeId: parsed.data.typeId })
      .returning();
    return c.json({ mapping: inserted }, 201);
  } catch (err: any) {
    // SQLite unique constraint violation — mapping already exists.
    if (err?.message?.includes("UNIQUE") || err?.message?.includes("unique")) {
      const [existing] = await db
        .select()
        .from(brandTypeMappings)
        .where(
          and(
            eq(brandTypeMappings.brandId, brandId),
            eq(brandTypeMappings.typeId, parsed.data.typeId),
          ),
        )
        .limit(1);
      return c.json({ mapping: existing, alreadyExists: true }, 200);
    }
    console.error("[brands] POST /:id/types error:", err);
    return c.json({ success: false, error: "Failed to add type mapping" }, 500);
  }
});

/**
 * DELETE /:id/types/:typeId — remove a brand ↔ type mapping.
 */
brandsRouter.delete("/:id/types/:typeId", async (c) => {
  const db = drizzle(c.env.DB);
  const brandId = Number(c.req.param("id"));
  const typeId = Number(c.req.param("typeId"));
  if (!Number.isInteger(brandId) || !Number.isInteger(typeId)) {
    return c.json({ success: false, error: "Invalid id" }, 400);
  }

  await db
    .delete(brandTypeMappings)
    .where(
      and(
        eq(brandTypeMappings.brandId, brandId),
        eq(brandTypeMappings.typeId, typeId),
      ),
    );

  return c.json({ success: true });
});
