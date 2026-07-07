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
 *   - showroom_brand_mappings — direct brand ↔ showroom relationship
 *   - showroom_product_mappings — showroom carries product (product has brandId)
 *   - showroom_store_products — product rows with brandId
 *   - product_images          — per-product imagery (newest used as imageUrl)
 *   - showroom_stores         — showroom metadata joined for brand detail
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
import { eq, and, or, isNull, inArray, like, desc, ne, sql } from "drizzle-orm";

import { brands } from "@backend/db/schema/brands/brands";
import { brandTypesDef } from "@backend/db/schema/brands/brand_types_def";
import { brandTypeMappings } from "@backend/db/schema/brands/brand_type_mappings";
import { showroomBrandMappings } from "@backend/db/schema/brands/showroom_brand_mappings";
import { brandIntel } from "@backend/db/schema/brands/brand_intel";
import { brandImages } from "@backend/db/schema/brands/brand_images";
import { brandProductLines } from "@backend/db/schema/brands/brand_product_lines";
import { showroomStoreProducts } from "@backend/db/schema/showroom/store_products";
import { showroomProductMappings } from "@backend/db/schema/showroom/product_mappings";
import { showroomStores } from "@backend/db/schema/showroom/stores";
import { productImages } from "@backend/db/schema/showroom/product_images";
import { faviconService } from "@backend/services/favicon";
import { enrichNewBrand } from "@backend/services/showroom/brand-enrichment";

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

/**
 * Schema for updating a brand — superset of createBrandSchema adding the
 * new editable rating/notes fields introduced in migration 0058.
 */
const updateBrandSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  websiteUrl: z.string().optional().nullable(),
  instagramUrl: z.string().optional().nullable(),
  /** Freeform homeowner notes on this brand. */
  personalNotes: z.string().optional().nullable(),
  /**
   * Aggregate online rating (0–5).
   * Must be between 0 and 5 inclusive, or null to clear.
   */
  onlineRating: z.number().min(0).max(5).optional().nullable(),
  /**
   * Homeowner's personal rating (0–5).
   * Must be between 0 and 5 inclusive, or null to clear.
   */
  userRating: z.number().min(0).max(5).optional().nullable(),
  /** Virtual — type mappings to attach; ignored on partial updates. */
  typeIds: z.array(z.number().int().positive()).optional(),
});

/** Body for the brand-type add sub-route. */
const addBrandTypeSchema = z.object({
  typeId: z.number().int().positive(),
});

// ─── OpenAPI response schemas ─────────────────────────────────────────────────

/**
 * Full brand shape — all columns including the new 0058 fields.
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
  personalNotes: z.string().nullable(),
  onlineRating: z.number().nullable(),
  userRating: z.number().nullable(),
  createdAt: z.union([z.date(), z.number()]).nullable(),
  updatedAt: z.union([z.date(), z.number()]).nullable(),
});

/**
 * Brand list item — full brand columns plus `productCount`.
 * Optionally includes `types` when `?include=types`.
 */
const brandListItemSchema = brandSchema.extend({
  productCount: z.number(),
  types: z
    .array(
      z.object({
        typeId: z.number(),
        name: z.string(),
      }),
    )
    .optional(),
});

/** Lean showroom shape returned in brand detail. */
const showroomRefSchema = z.object({
  id: z.number(),
  name: z.string(),
  locationAddress: z.string().nullable(),
});

/** Product item with its newest image URL (or null). */
const brandProductSchema = z.object({
  id: z.number(),
  itemName: z.string(),
  productType: z.string().nullable(),
  imageUrl: z.string().nullable(),
});

/** Full brand detail response. */
const brandDetailSchema = z.object({
  brand: brandSchema,
  types: z.array(
    z.object({
      mappingId: z.number(),
      typeId: z.number(),
      typeName: z.string(),
      typeDescription: z.string().nullable(),
      brandIconCfImagesUrl: z.string().nullable(),
    }),
  ),
  showrooms: z.array(showroomRefSchema),
  products: z.array(brandProductSchema),
  productCount: z.number(),
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
 * GET / — list all brands with product counts and ratings.
 *
 * Query params:
 *   `?search=<q>`    — filter brands whose name contains `q` (case-insensitive,
 *                       SQLite LIKE), max 20 results, ordered by name.
 *                       When omitted, returns the full list (no limit applied).
 *   `?include=types` — attach each brand's type mappings (joined with brand_types_def).
 *                       Compatible with `?search=`.
 *
 * Always included: `iconCfImagesUrl`, `instagramUrl`, `onlineRating`, `userRating`,
 * and `productCount` (count of showroom_store_products rows for each brand).
 *
 * `productCount` is computed with a single grouped aggregate — NOT per-brand queries.
 */
brandsRouter.openapi(
  createRoute({
    method: "get",
    path: "/",
    operationId: "listBrands",
    tags: ["Brands"],
    summary: "List all brands (supports ?search= autocomplete, includes productCount)",
    request: {
      query: z.object({
        include: z.string().optional(),
        /** Partial name match for autocomplete — max 20 results returned. */
        search: z.string().min(1).optional(),
      }),
    },
    responses: {
      200: {
        description: "Brand list with product counts and ratings",
        content: {
          "application/json": {
            schema: z.object({ brands: z.array(brandListItemSchema) }),
          },
        },
      },
    },
  }),
  async (c) => {
    const db = drizzle(c.env.DB);
    const { include: includeParam = "", search } = c.req.valid("query");
    const includes = new Set(includeParam.split(",").map((s) => s.trim()).filter(Boolean));

    // Build the base brand query.  When `search` is present, apply a LIKE filter
    // and cap results at 20.  SQLite LIKE is case-insensitive for ASCII by default.
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

    if (brandRows.length === 0) {
      return c.json({ brands: [] });
    }

    const brandIds = brandRows.map((b) => b.id) as [number, ...number[]];

    // ── Product counts — single grouped aggregate query ──────────────────────
    // SELECT brand_id, COUNT(*) AS cnt FROM showroom_store_products
    // WHERE brand_id IN (...) GROUP BY brand_id
    const productCountRows = await db
      .select({
        brandId: showroomStoreProducts.brandId,
        cnt: sql<number>`count(*)`.as("cnt"),
      })
      .from(showroomStoreProducts)
      .where(inArray(showroomStoreProducts.brandId, brandIds))
      .groupBy(showroomStoreProducts.brandId);

    const productCountMap = new Map<number, number>();
    for (const r of productCountRows) {
      if (r.brandId !== null) {
        productCountMap.set(r.brandId, r.cnt);
      }
    }

    // ── Optional type mappings ───────────────────────────────────────────────
    if (!includes.has("types")) {
      const enriched = brandRows.map((b) => ({
        ...b,
        productCount: productCountMap.get(b.id) ?? 0,
      }));
      return c.json({ brands: enriched });
    }

    // Fetch type mappings for all returned brands in one query.
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
      productCount: productCountMap.get(b.id) ?? 0,
      types: typesMap.get(b.id) ?? [],
    }));

    return c.json({ brands: enriched });
  },
);

/**
 * GET /:id — brand detail with type mappings, showroom locations, and products.
 *
 * Returns:
 *   - `brand`: full row including personalNotes, onlineRating, userRating.
 *   - `types`: array of type mappings joined to brand_types_def.
 *   - `showrooms`: DISTINCT showrooms carrying this brand — union of:
 *       (a) showroom_brand_mappings rows for brandId
 *       (b) showrooms that have a product of this brand via showroom_product_mappings
 *     Joined to showroom_stores for { id, name, locationAddress }. De-duped by id.
 *   - `products`: brand's products with newest image URL (or null).
 *     Uses two queries + JS-side merge — avoids N+1 and handles SQLite group-by limits.
 *   - `productCount`: total count of products.
 *   - `intel`: brand_intel row from the BrandResearchWorkflow (or null).
 *   - `productLines`: brand_product_lines ordered by sortOrder (flagship first).
 *   - `images`: brand_images where reviewStatus != 'rejected', newest first, max 24.
 *
 * Uses a plain `.get()` handler (not `openapi()`) to avoid the Drizzle Date ↔
 * JSON string type mismatch that the strict `RouteConfigToTypedResponse` check
 * enforces — consistent with the original pattern in this file.
 */
brandsRouter.get("/:id", async (c) => {
    const db = drizzle(c.env.DB);
    const brandId = Number(c.req.param("id"));

    if (!Number.isFinite(brandId) || brandId <= 0) {
      return c.json({ success: false, error: "Invalid brand id" }, 400);
    }

    const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
    if (!brand) {
      return c.json({ success: false, error: "Brand not found" }, 404);
    }

    // ── Fire all independent queries concurrently ────────────────────────────
    const [
      typeMappingRows,
      showroomBrandRows,
      showroomProductRows,
      productRows,
      intelRows,
      productLineRows,
      imageRows,
    ] = await Promise.all([
        // (1) Type mappings
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

        // (2a) Showrooms via direct brand mapping
        db
          .select({
            id: showroomStores.id,
            name: showroomStores.name,
            locationAddress: showroomStores.locationAddress,
          })
          .from(showroomBrandMappings)
          .innerJoin(showroomStores, eq(showroomBrandMappings.showroomId, showroomStores.id))
          .where(eq(showroomBrandMappings.brandId, brandId)),

        // (2b) Showrooms via product mapping (showroom carries a product of this brand)
        db
          .select({
            id: showroomStores.id,
            name: showroomStores.name,
            locationAddress: showroomStores.locationAddress,
          })
          .from(showroomProductMappings)
          .innerJoin(
            showroomStoreProducts,
            eq(showroomProductMappings.productId, showroomStoreProducts.id),
          )
          .innerJoin(showroomStores, eq(showroomProductMappings.showroomId, showroomStores.id))
          .where(eq(showroomStoreProducts.brandId, brandId)),

        // (3) Products for this brand
        db
          .select({
            id: showroomStoreProducts.id,
            itemName: showroomStoreProducts.itemName,
            productType: showroomStoreProducts.productType,
          })
          .from(showroomStoreProducts)
          .where(eq(showroomStoreProducts.brandId, brandId)),

        // (4) Deep-research intel (1:1 row, may not exist yet)
        db
          .select()
          .from(brandIntel)
          .where(eq(brandIntel.brandId, brandId))
          .limit(1),

        // (5) Product lines ordered by sortOrder (flagship first)
        db
          .select()
          .from(brandProductLines)
          .where(eq(brandProductLines.brandId, brandId))
          .orderBy(brandProductLines.sortOrder),

        // (6) Images — everything not rejected, newest first, max 24
        db
          .select()
          .from(brandImages)
          .where(
            and(
              eq(brandImages.brandId, brandId),
              ne(brandImages.reviewStatus, "rejected"),
            ),
          )
          .orderBy(desc(brandImages.id))
          .limit(24),
      ]);

    // ── De-dupe showrooms by id (UNION of brand-mapping + product-mapping) ───
    const showroomMap = new Map<number, { id: number; name: string; locationAddress: string | null }>();
    for (const r of showroomBrandRows) {
      showroomMap.set(r.id, r);
    }
    for (const r of showroomProductRows) {
      if (!showroomMap.has(r.id)) {
        showroomMap.set(r.id, r);
      }
    }
    const showrooms = Array.from(showroomMap.values());

    // ── Newest product image per product — single query, JS-side max ─────────
    // Fetch the latest image row per product. We query ALL images for these
    // products in one round-trip, then take the highest id per product in JS.
    // Using MAX(id) as a proxy for "newest created" avoids a subquery while
    // being safe given autoIncrement semantics.
    let imageUrlMap = new Map<number, string>();
    if (productRows.length > 0) {
      const productIds = productRows.map((p) => p.id) as [number, ...number[]];
      const imageRows = await db
        .select({
          storeProductId: productImages.storeProductId,
          deliveryUrl: productImages.deliveryUrl,
          imgId: productImages.id,
        })
        .from(productImages)
        .where(inArray(productImages.storeProductId, productIds))
        .orderBy(desc(productImages.id));

      // Keep only the first (highest id = newest) image per product.
      for (const row of imageRows) {
        if (!imageUrlMap.has(row.storeProductId)) {
          imageUrlMap.set(row.storeProductId, row.deliveryUrl);
        }
      }
    }

    const products = productRows.map((p) => ({
      id: p.id,
      itemName: p.itemName,
      productType: p.productType ?? null,
      imageUrl: imageUrlMap.get(p.id) ?? null,
    }));

    return c.json({
      brand,
      types: typeMappingRows,
      showrooms,
      products,
      productCount: products.length,
      /** Deep-research intel row (or null before the first workflow run). */
      intel: intelRows[0] ?? null,
      /** Top product lines from the research workflow, flagship first. */
      productLines: productLineRows,
      /** Scraped brand images (pending + approved), newest first, max 24. */
      images: imageRows,
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

      // Kick the deep-research workflow in the background — its mark-running
      // step upserts the brand_intel row, so no pre-insert is needed here.
      c.executionCtx.waitUntil(
        c.env.BRAND_RESEARCH_WORKFLOW.create({
          params: { brandId: inserted.id },
        }).catch((err) =>
          console.error(
            `[brands] POST / research workflow create failed for brand ${inserted.id}:`,
            err,
          ),
        ),
      );

      return c.json({ brand: inserted }, 201);
    } catch (err: unknown) {
      console.error("[brands] POST / error:", err);
      return c.json({ success: false as const, error: "Failed to create brand" }, 500);
    }
  },
);

/**
 * PUT /:id — update brand fields.
 *
 * Accepts all original fields plus the new 0058 additions:
 *   - `personalNotes`  (string | null)
 *   - `onlineRating`   (number 0–5 | null)
 *   - `userRating`     (number 0–5 | null)
 *
 * If `websiteUrl` is present in the body AND differs from the stored value
 * (or the brand has no icon yet), triggers a favicon re-hydration in background.
 *
 * Uses a plain `.put()` handler (not `openapi()`) to avoid the Drizzle Date ↔
 * JSON string type mismatch — consistent with the original pattern in this file.
 */
brandsRouter.put("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const brandId = Number(c.req.param("id"));

  if (!Number.isFinite(brandId) || brandId <= 0) {
    return c.json({ success: false, error: "Invalid brand id" }, 400);
  }

  const body = await c.req.json();
  const parsed = updateBrandSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  const { typeIds: _typeIds, ...updateFields } = parsed.data;

  // Fetch existing row to compare websiteUrl + icon.
  const [existing] = await db
    .select({ websiteUrl: brands.websiteUrl, iconCfImagesUrl: brands.iconCfImagesUrl })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  if (!existing) {
    return c.json({ success: false, error: "Brand not found" }, 404);
  }

  try {
    const [updated] = await db
      .update(brands)
      .set({ ...updateFields, updatedAt: new Date() } as Partial<typeof brands.$inferInsert>)
      .where(eq(brands.id, brandId))
      .returning();

    if (!updated) {
      return c.json({ success: false, error: "Brand not found" }, 404);
    }

    // Trigger favicon refresh when websiteUrl changed or icon is missing.
    const incomingUrl = updateFields.websiteUrl ?? null;
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
  } catch (err: unknown) {
    console.error("[brands] PUT /:id error:", err);
    return c.json({ success: false, error: "Failed to update brand" }, 500);
  }
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
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // SQLite unique constraint violation — mapping already exists.
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
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

// ─── BRAND ENRICHMENT BACKFILL ────────────────────────────────────────────────

/** Cap on the number of brands processed per backfill run — avoids stampeding Workers-AI. */
const ENRICHMENT_BACKFILL_LIMIT = 20;

/**
 * POST /backfill-enrichment — enrich existing brands missing website / icon /
 * rating / price point.
 *
 * Finds up to `ENRICHMENT_BACKFILL_LIMIT` brands where any of
 * `websiteUrl`, `iconCfImagesUrl`, `onlineRating`, or `pricePoint` is NULL,
 * ordered by `updatedAt` ASCENDING — every enrichment attempt (successful or
 * not) bumps `updatedAt`, so this ordering pushes already-attempted brands to
 * the back of the queue instead of starving it with permanently-unenrichable
 * rows on every run. Then runs `enrichNewBrand` for each — fill-blanks only,
 * same doctrine as inline scrape-time enrichment. Runs sequentially inside a
 * single `c.executionCtx.waitUntil(...)` async IIFE (never parallel, so we
 * don't stampede Workers-AI), with a per-brand try/catch so one failure can't
 * abort the rest of the queue. Returns immediately with a 202 + count queued.
 */
brandsRouter.post("/backfill-enrichment", async (c) => {
  const db = drizzle(c.env.DB);

  const candidates = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(
      or(
        isNull(brands.websiteUrl),
        isNull(brands.iconCfImagesUrl),
        isNull(brands.onlineRating),
        isNull(brands.pricePoint),
      ),
    )
    .orderBy(brands.updatedAt)
    .limit(ENRICHMENT_BACKFILL_LIMIT);

  if (candidates.length === 0) {
    return c.json({ success: true, queued: 0 }, 202);
  }

  c.executionCtx.waitUntil(
    (async () => {
      for (const brand of candidates) {
        try {
          await enrichNewBrand(c.env, brand.id, brand.name);
        } catch (err) {
          console.error(
            `[brands] POST /backfill-enrichment failed for brand ${brand.id}:`,
            err,
          );
        }

        // Also kick the deep-research workflow — skipped when a run is
        // already in flight. All workflow writes are fill-blanks, so
        // repeat runs against complete brands are safe (and cheap to skip).
        try {
          const db2 = drizzle(c.env.DB);
          const [intel] = await db2
            .select({ researchStatus: brandIntel.researchStatus })
            .from(brandIntel)
            .where(eq(brandIntel.brandId, brand.id))
            .limit(1);
          if (intel?.researchStatus !== "running") {
            await c.env.BRAND_RESEARCH_WORKFLOW.create({
              params: { brandId: brand.id },
            });
          }
        } catch (err) {
          console.error(
            `[brands] POST /backfill-enrichment workflow create failed for brand ${brand.id}:`,
            err,
          );
        }
      }
    })(),
  );

  return c.json({ success: true, queued: candidates.length }, 202);
});

// ─── BRAND DEEP-RESEARCH TRIGGER ──────────────────────────────────────────────

/**
 * POST /:id/research — manually (re)trigger the BrandResearchWorkflow.
 *
 * Guards:
 *   - 400 on a non-numeric id, 404 when the brand doesn't exist.
 *   - 409 when `brand_intel.research_status` is already "running".
 *
 * The workflow's writes are fill-blanks only, so re-running against a
 * completed brand simply fills whatever is still missing. Marks the intel
 * row "pending" before creating the workflow instance.
 *
 * Response: `{ queued: true }` (202).
 */
brandsRouter.post("/:id/research", async (c) => {
  const db = drizzle(c.env.DB);
  const brandId = Number(c.req.param("id"));
  if (!Number.isFinite(brandId) || brandId <= 0) {
    return c.json({ success: false, error: "Invalid brand id" }, 400);
  }

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  if (!brand) {
    return c.json({ success: false, error: "Brand not found" }, 404);
  }

  const [intel] = await db
    .select({ researchStatus: brandIntel.researchStatus })
    .from(brandIntel)
    .where(eq(brandIntel.brandId, brandId))
    .limit(1);
  if (intel?.researchStatus === "running") {
    return c.json(
      { success: false, error: "Research is already running for this brand" },
      409,
    );
  }

  try {
    await db
      .insert(brandIntel)
      .values({ brandId, researchStatus: "pending" })
      .onConflictDoUpdate({
        target: brandIntel.brandId,
        set: { researchStatus: "pending", updatedAt: new Date() },
      });

    await c.env.BRAND_RESEARCH_WORKFLOW.create({ params: { brandId } });
    return c.json({ queued: true }, 202);
  } catch (err) {
    console.error(`[brands] POST /:id/research failed for brand ${brandId}:`, err);
    return c.json({ success: false, error: "Failed to queue brand research" }, 500);
  }
});
