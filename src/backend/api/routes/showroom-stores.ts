/**
 * @fileoverview Showroom Stores API
 *
 * CRUD for showroom stores, products, categories, ratings, notes,
 * scan log, cities, and gap analysis. Mounts at /api/showroom-stores.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc, and, like } from "drizzle-orm";
import { getAgentByName } from "agents";

import {
  showroomStores,
  showroomStoreProducts,
  showroomStoreCategory,
  showroomStoreCategoryMapping,
  storeBayareaCities,
  storeNotes,
  storeProductNotes,
  storeRating,
  showroomStoreRatings,
  storeResearch,
  storeProductAreaDef,
  storePaMapping,
  showroomScanLog,
  showroomTagDef,
  storeTagMapping,
  storeProductResearch,
  storeProductRating,
  productImages,
  productSpecs,
  showroomImages,
} from "@backend/db/schema/showroom/index";
import {
  generateProductDraftPrompt,
} from "@backend/ai/agents/ShowroomResearchAgent/methods";
import type { ShowroomResearchAgent } from "@backend/ai/agents/ShowroomResearchAgent";

export const showroomStoresRouter = new OpenAPIHono<{ Bindings: Env }>();

// ─── Validation Schemas ───────────────────────────────────────────────────────

const createStoreSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  pricePoint: z.enum(["$", "$$", "$$$", "$$$$"]).optional().nullable(),
  bayAreaCityId: z.number().optional().nullable(),
  locationAddress: z.string().optional().nullable(),
  phoneNumber: z.string().optional().nullable(),
  emailAddress: z.string().optional().nullable(),
  websiteUrl: z.string().optional().nullable(),
  zipCode: z.string().optional().nullable(),
  googleMapsLink: z.string().optional().nullable(),
  weekdayHours: z.string().optional().nullable(),
  weekendHours: z.string().optional().nullable(),
  isOpenWeekends: z.boolean().optional().default(false),
  isAppointmentOnly: z.boolean().optional().default(false),
  isFlagshipLocation: z.boolean().optional().default(false),
  scale: z.string().optional().nullable(),
  inventoryFocus: z.string().optional().nullable(),
  targetDemographic: z.string().optional().nullable(),
  mainPocFullname: z.string().optional().nullable(),
  mainPocPhoneNumber: z.string().optional().nullable(),
  mainPocEmailAddress: z.string().optional().nullable(),
  distanceFromSfTime: z.string().optional().nullable(),
  distanceFromSfMiles: z.string().optional().nullable(),
  locationNotes: z.string().optional().nullable(),
});

const createProductSchema = z.object({
  storeId: z.number(),
  itemName: z.string().min(1),
  description: z.string().optional().nullable(),
  colors: z.string().optional().nullable(),
  preferredColor: z.string().optional().nullable(),
  sku: z.string().optional().nullable(),
  price: z.string().optional().nullable(),
  jsonDetails: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  leadTime: z.string().optional().nullable(),
  possibleDiscounts: z.string().optional().nullable(),
  tradeDiscount: z.string().optional().nullable(),
});

const productIdParamsSchema = z.object({
  productId: z.string().regex(/^\d+$/).transform(Number),
});

const storeIdParamsSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
});

const categoryIdParamsSchema = z.object({
  categoryId: z.string().regex(/^\d+$/).transform(Number),
});

const draftPromptRequestSchema = z
  .object({
    negativeConstraints: z.array(z.string().min(1)).default([]),
  })
  .default({ negativeConstraints: [] });

const deepSweepRequestSchema = z
  .object({
    prompt: z.string().min(1).optional(),
    maxSources: z.number().int().min(1).max(10).optional(),
    negativeConstraints: z.array(z.string().min(1)).default([]),
    researchMode: z.enum(["quick", "deep"]).default("quick"),
    deepResearchWaitMs: z.number().int().min(15_000).max(240_000).optional(),
    enableMcpBridge: z.boolean().default(false),
    triggerSource: z
      .enum([
        "manual",
        "product-created",
        "store-created",
        "cron-category-gap",
        "cron-rejection-loop",
      ])
      .default("manual"),
  })
  .default({
    negativeConstraints: [],
    researchMode: "quick",
    enableMcpBridge: false,
    triggerSource: "manual",
  });

const draftPromptResponseSchema = z.object({
  success: z.boolean(),
  productId: z.number(),
  prompt: z.string(),
});

const sweepResultSchema = z.object({
  success: z.boolean(),
  targetType: z.enum(["product", "store", "category"]),
  targetId: z.number(),
  citationsFound: z.number(),
  sourcesProcessed: z.number(),
  findingsWritten: z.number(),
  imagesWritten: z.number(),
  specsWritten: z.number(),
  vectorsWritten: z.number(),
  warnings: z.array(z.string()),
});

const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

async function getShowroomResearchAgent(env: Env) {
  return getAgentByName<Env, ShowroomResearchAgent>(
    env.SHOWROOM_RESEARCH_AGENT as any,
    "showroom-research",
  );
}

// ─── RESEARCH ORCHESTRATION ──────────────────────────────────────────────────

showroomStoresRouter.openapi(
  createRoute({
    method: "post",
    path: "/products/:productId/research/draft-prompt",
    operationId: "createShowroomProductResearchDraftPrompt",
    tags: ["Showroom Research"],
    summary: "Generate a draft research prompt for a showroom product",
    request: {
      params: productIdParamsSchema,
      body: {
        required: false,
        content: {
          "application/json": {
            schema: draftPromptRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Draft prompt generated",
        content: {
          "application/json": {
            schema: draftPromptResponseSchema,
          },
        },
      },
      404: {
        description: "Product not found",
        content: { "application/json": { schema: errorResponseSchema } },
      },
      500: {
        description: "Prompt generation failed",
        content: { "application/json": { schema: errorResponseSchema } },
      },
    },
  }),
  async (c) => {
    const { productId } = c.req.valid("param");
    const body = c.req.valid("json") ?? { negativeConstraints: [] };

    try {
      const prompt = await generateProductDraftPrompt(
        c.env,
        productId,
        body.negativeConstraints ?? [],
      );
      return c.json({ success: true, productId, prompt }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("not found")) {
        return c.json({ success: false as const, error: message }, 404);
      }
      return c.json({ success: false as const, error: message }, 500);
    }
  },
);

showroomStoresRouter.openapi(
  createRoute({
    method: "post",
    path: "/products/:productId/research/deep-sweep",
    operationId: "runShowroomProductResearchDeepSweep",
    tags: ["Showroom Research"],
    summary: "Run citation-backed product deep research",
    request: {
      params: productIdParamsSchema,
      body: {
        required: false,
        content: {
          "application/json": {
            schema: deepSweepRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Product deep sweep completed",
        content: { "application/json": { schema: sweepResultSchema } },
      },
      500: {
        description: "Product deep sweep failed",
        content: { "application/json": { schema: sweepResultSchema } },
      },
    },
  }),
  async (c) => {
    const { productId } = c.req.valid("param");
    const body = c.req.valid("json") ?? {};
    const agent = await getShowroomResearchAgent(c.env);
    const result = await agent.deepSweepProduct({
      productId,
      prompt: body.prompt,
      maxSources: body.maxSources,
      negativeConstraints: body.negativeConstraints,
      triggerSource: body.triggerSource,
      researchMode: body.researchMode,
      deepResearchWaitMs: body.deepResearchWaitMs,
      enableMcpBridge: body.enableMcpBridge,
      mcpServerUrl: new URL("/api/mcp", c.req.url).toString(),
    });
    return c.json(result, result.success ? 200 : 500);
  },
);

showroomStoresRouter.openapi(
  createRoute({
    method: "post",
    path: "/:id/research/deep-sweep",
    operationId: "runShowroomStoreResearchDeepSweep",
    tags: ["Showroom Research"],
    summary: "Run citation-backed showroom/store deep research",
    request: {
      params: storeIdParamsSchema,
      body: {
        required: false,
        content: {
          "application/json": {
            schema: deepSweepRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Store deep sweep completed",
        content: { "application/json": { schema: sweepResultSchema } },
      },
      500: {
        description: "Store deep sweep failed",
        content: { "application/json": { schema: sweepResultSchema } },
      },
    },
  }),
  async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json") ?? {};
    const agent = await getShowroomResearchAgent(c.env);
    const result = await agent.deepSweepStore({
      storeId: id,
      prompt: body.prompt,
      maxSources: body.maxSources,
      negativeConstraints: body.negativeConstraints,
      triggerSource: body.triggerSource,
      researchMode: body.researchMode,
      deepResearchWaitMs: body.deepResearchWaitMs,
      enableMcpBridge: body.enableMcpBridge,
      mcpServerUrl: new URL("/api/mcp", c.req.url).toString(),
    });
    return c.json(result, result.success ? 200 : 500);
  },
);

showroomStoresRouter.openapi(
  createRoute({
    method: "post",
    path: "/meta/categories/:categoryId/research/deep-sweep",
    operationId: "runShowroomCategoryResearchDeepSweep",
    tags: ["Showroom Research"],
    summary: "Run citation-backed category gap research",
    request: {
      params: categoryIdParamsSchema,
      body: {
        required: false,
        content: {
          "application/json": {
            schema: deepSweepRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Category deep sweep completed",
        content: { "application/json": { schema: sweepResultSchema } },
      },
      500: {
        description: "Category deep sweep failed",
        content: { "application/json": { schema: sweepResultSchema } },
      },
    },
  }),
  async (c) => {
    const { categoryId } = c.req.valid("param");
    const body = c.req.valid("json") ?? {};
    const agent = await getShowroomResearchAgent(c.env);
    const result = await agent.deepSweepCategory({
      categoryId,
      prompt: body.prompt,
      maxSources: body.maxSources,
      negativeConstraints: body.negativeConstraints,
      triggerSource: body.triggerSource,
      researchMode: body.researchMode,
      deepResearchWaitMs: body.deepResearchWaitMs,
      enableMcpBridge: body.enableMcpBridge,
      mcpServerUrl: new URL("/api/mcp", c.req.url).toString(),
    });
    return c.json(result, result.success ? 200 : 500);
  },
);

// ─── RESEARCH CONTEXT READS ──────────────────────────────────────────────────
//
// The deep-sweep agent writes findings, images, and specs but the showroom
// schema shipped without read endpoints for them. These two GET routes expose
// the persisted sourcing artifacts so the frontend Review Ledger and Media
// Galleries render live data (never mock). Read-only; gated by the
// /api/showroom-stores requireAccessAuth middleware in api/index.ts.

/**
 * GET /products/:pid/research/context — Sourcing artifacts for one product.
 *
 * Returns the product row plus its research findings (sentiment-coded),
 * scraped product images, extracted specs, and the homeowner's active rating.
 * Powers the product-scoped ledger, media gallery, and specs panels.
 */
showroomStoresRouter.get("/products/:pid/research/context", async (c) => {
  const db = drizzle(c.env.DB);
  const productId = Number(c.req.param("pid"));
  if (!Number.isInteger(productId)) {
    return c.json({ success: false, error: "Invalid product id" }, 400);
  }

  const [product] = await db
    .select()
    .from(showroomStoreProducts)
    .where(eq(showroomStoreProducts.id, productId))
    .limit(1);

  if (!product) {
    return c.json({ success: false, error: "Product not found" }, 404);
  }

  const [findings, images, specs, ratings] = await Promise.all([
    db
      .select()
      .from(storeProductResearch)
      .where(eq(storeProductResearch.storeProductId, productId))
      .orderBy(desc(storeProductResearch.timestamp)),
    db
      .select()
      .from(productImages)
      .where(eq(productImages.storeProductId, productId))
      .orderBy(desc(productImages.createdAt)),
    db
      .select()
      .from(productSpecs)
      .where(eq(productSpecs.storeProductId, productId))
      .orderBy(desc(productSpecs.confidence)),
    db
      .select()
      .from(storeProductRating)
      .where(
        and(
          eq(storeProductRating.storeProductId, productId),
          eq(storeProductRating.isActive, true),
        ),
      ),
  ]);

  return c.json({
    success: true,
    product,
    findings,
    images,
    specs,
    rating: ratings[0] ?? null,
  });
});

/**
 * GET /:id/research/context — Sourcing artifacts for one showroom/store.
 *
 * Returns the store's research findings (sentiment-coded), scraped storefront
 * images, external platform ratings (sources), and the homeowner's active
 * rating. Powers the showroom-scoped ledger and storefront media gallery.
 */
showroomStoresRouter.get("/:id/research/context", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  const [store] = await db
    .select()
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);

  if (!store) {
    return c.json({ success: false, error: "Store not found" }, 404);
  }

  const [findings, images, externalRatings, ratings] = await Promise.all([
    db
      .select()
      .from(storeResearch)
      .where(eq(storeResearch.storeId, storeId))
      .orderBy(desc(storeResearch.timestamp)),
    db
      .select()
      .from(showroomImages)
      .where(eq(showroomImages.storeId, storeId))
      .orderBy(desc(showroomImages.createdAt)),
    db
      .select()
      .from(showroomStoreRatings)
      .where(eq(showroomStoreRatings.storeId, storeId))
      .orderBy(desc(showroomStoreRatings.scrapedAt)),
    db
      .select()
      .from(storeRating)
      .where(
        and(eq(storeRating.storeId, storeId), eq(storeRating.isActive, true)),
      ),
  ]);

  return c.json({
    success: true,
    store,
    findings,
    images,
    externalRatings,
    rating: ratings[0] ?? null,
  });
});

// ─── HITL REVIEW WRITES ───────────────────────────────────────────────────────
//
// Per-fact and per-image approve/reject. Workers AI parses findings against a
// fixed target, so a fact can be mis-attributed and scraping can surface junk
// imagery; these endpoints let the homeowner approve correct artifacts and
// reject wrong/spam ones. The reason on a rejection is retained and (for
// findings) replayed as a negative constraint on the next sweep. Read-only
// gated by the /api/showroom-stores requireAccessAuth middleware.

/** Body shape for both review endpoints. */
const reviewBodySchema = z.object({
  scope: z.enum(["product", "store"]),
  reviewStatus: z.enum(["pending", "approved", "rejected"]),
  reviewReason: z.string().max(500).optional().nullable(),
});

/**
 * PATCH /research/findings/:id — set a finding's HITL review state.
 *
 * `scope` selects the table: "product" → store_product_research,
 * "store" → store_research (ids are independent across the two tables).
 */
showroomStoresRouter.patch("/research/findings/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) {
    return c.json({ success: false, error: "Invalid finding id" }, 400);
  }

  const parsed = reviewBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }
  const { scope, reviewStatus, reviewReason } = parsed.data;

  const patch = {
    reviewStatus,
    reviewReason: reviewReason ?? null,
    reviewedAt: new Date(),
  };

  const [updated] =
    scope === "product"
      ? await db
          .update(storeProductResearch)
          .set(patch)
          .where(eq(storeProductResearch.id, id))
          .returning()
      : await db
          .update(storeResearch)
          .set(patch)
          .where(eq(storeResearch.id, id))
          .returning();

  if (!updated) {
    return c.json({ success: false, error: "Finding not found" }, 404);
  }
  return c.json({ success: true, finding: updated });
});

/**
 * PATCH /research/images/:id — set a scraped image's HITL review state.
 *
 * `scope` selects the table: "product" → product_images,
 * "store" → showroom_images. Rejecting marks junk/spam so it is not surfaced.
 */
showroomStoresRouter.patch("/research/images/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id)) {
    return c.json({ success: false, error: "Invalid image id" }, 400);
  }

  const parsed = reviewBodySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }
  const { scope, reviewStatus, reviewReason } = parsed.data;

  const patch = {
    reviewStatus,
    reviewReason: reviewReason ?? null,
    reviewedAt: new Date(),
  };

  const [updated] =
    scope === "product"
      ? await db
          .update(productImages)
          .set(patch)
          .where(eq(productImages.id, id))
          .returning()
      : await db
          .update(showroomImages)
          .set(patch)
          .where(eq(showroomImages.id, id))
          .returning();

  if (!updated) {
    return c.json({ success: false, error: "Image not found" }, 404);
  }
  return c.json({ success: true, image: updated });
});

// ─── STORES CRUD ──────────────────────────────────────────────────────────────

/**
 * GET / — List all stores with optional filters.
 * Query params: ?city=San+Francisco&pricePoint=$$$&search=studio
 */
showroomStoresRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const cityFilter = c.req.query("city");
  const priceFilter = c.req.query("pricePoint");
  const search = c.req.query("search");
  const hubFilter = c.req.query("hub");

  let query = db
    .select({
      store: showroomStores,
      cityName: storeBayareaCities.bayAreaCityName,
      hubRoute: storeBayareaCities.hubRoute,
      hubName: storeBayareaCities.hubName,
    })
    .from(showroomStores)
    .leftJoin(
      storeBayareaCities,
      eq(showroomStores.bayAreaCityId, storeBayareaCities.id)
    )
    .orderBy(desc(showroomStores.createdAt))
    .$dynamic();

  const conditions = [];
  if (priceFilter) {
    conditions.push(
      eq(showroomStores.pricePoint, priceFilter as "$" | "$$" | "$$$" | "$$$$")
    );
  }
  if (search) {
    conditions.push(like(showroomStores.name, `%${search}%`));
  }
  if (cityFilter) {
    conditions.push(eq(storeBayareaCities.bayAreaCityName, cityFilter));
  }
  if (hubFilter) {
    conditions.push(eq(storeBayareaCities.hubRoute, hubFilter));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  const rows = await query;

  return c.json({
    stores: rows.map((r) => ({
      ...r.store,
      cityName: r.cityName,
      hubRoute: r.hubRoute,
      hubName: r.hubName,
    })),
  });
});

/**
 * GET /:id — Full store detail with products, categories, notes, ratings.
 */
showroomStoresRouter.get("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));

  const [store] = await db
    .select({
      store: showroomStores,
      cityName: storeBayareaCities.bayAreaCityName,
      hubRoute: storeBayareaCities.hubRoute,
      hubName: storeBayareaCities.hubName,
    })
    .from(showroomStores)
    .leftJoin(
      storeBayareaCities,
      eq(showroomStores.bayAreaCityId, storeBayareaCities.id)
    )
    .where(eq(showroomStores.id, storeId))
    .limit(1);

  if (!store) return c.json({ error: "Store not found" }, 404);

  // Parallel data loads
  const [products, categories, notes, ratings, externalRatings, research, tags] =
    await Promise.all([
      db
        .select()
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.storeId, storeId))
        .orderBy(desc(showroomStoreProducts.createdAt)),
      db
        .select({
          mapping: showroomStoreCategoryMapping,
          category: showroomStoreCategory,
        })
        .from(showroomStoreCategoryMapping)
        .innerJoin(
          showroomStoreCategory,
          eq(showroomStoreCategoryMapping.categoryId, showroomStoreCategory.id)
        )
        .where(eq(showroomStoreCategoryMapping.storeId, storeId)),
      db
        .select()
        .from(storeNotes)
        .where(
          and(eq(storeNotes.storeId, storeId), eq(storeNotes.isActive, true))
        )
        .orderBy(desc(storeNotes.timestamp)),
      db
        .select()
        .from(storeRating)
        .where(
          and(
            eq(storeRating.storeId, storeId),
            eq(storeRating.isActive, true)
          )
        ),
      db
        .select()
        .from(showroomStoreRatings)
        .where(eq(showroomStoreRatings.storeId, storeId))
        .orderBy(desc(showroomStoreRatings.scrapedAt)),
      db
        .select()
        .from(storeResearch)
        .where(eq(storeResearch.storeId, storeId))
        .orderBy(desc(storeResearch.timestamp)),
      db
        .select({
          mapping: storeTagMapping,
          tag: showroomTagDef,
        })
        .from(storeTagMapping)
        .innerJoin(
          showroomTagDef,
          eq(storeTagMapping.showroomTagId, showroomTagDef.id)
        )
        .where(eq(storeTagMapping.storeId, storeId)),
    ]);

  return c.json({
    ...store.store,
    cityName: store.cityName,
    hubRoute: store.hubRoute,
    hubName: store.hubName,
    products,
    categories: categories.map((r) => ({
      ...r.mapping,
      categoryName: r.category.name,
      categoryDescription: r.category.description,
    })),
    notes,
    userRating: ratings[0] ?? null,
    externalRatings,
    research,
    tags: tags.map((r) => ({
      ...r.mapping,
      tagName: r.tag.name,
      tagColor: r.tag.color,
    })),
  });
});

/**
 * POST / — Create a new store.
 */
showroomStoresRouter.post("/", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json();
  const data = createStoreSchema.parse(body);

  const [inserted] = await db
    .insert(showroomStores)
    .values(data)
    .returning();

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const agent = await getShowroomResearchAgent(c.env);
        await agent.researchStore(inserted.id);
      } catch (error) {
        console.error(`ShowroomResearchAgent store research failed for ${inserted.id}:`, error);
      }
    })(),
  );

  return c.json({ store: inserted }, 201);
});

/**
 * PUT /:id — Update a store.
 */
showroomStoresRouter.put("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const body = await c.req.json();
  const data = createStoreSchema.partial().parse(body);

  const [updated] = await db
    .update(showroomStores)
    .set({ ...data, updatedAt: new Date() } as Partial<typeof showroomStores.$inferInsert>)
    .where(eq(showroomStores.id, storeId))
    .returning();

  if (!updated) return c.json({ error: "Store not found" }, 404);

  return c.json({ store: updated });
});

/**
 * DELETE /:id — Delete a store (hard delete).
 */
showroomStoresRouter.delete("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));

  await db.delete(showroomStores).where(eq(showroomStores.id, storeId));

  return c.json({ success: true });
});

// ─── PRODUCTS CRUD ────────────────────────────────────────────────────────────

/**
 * GET /:id/products — List products for a store.
 */
showroomStoresRouter.get("/:id/products", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));

  const products = await db
    .select()
    .from(showroomStoreProducts)
    .where(eq(showroomStoreProducts.storeId, storeId))
    .orderBy(desc(showroomStoreProducts.createdAt));

  return c.json({ products });
});

/**
 * POST /:id/products — Add a product to a store.
 */
showroomStoresRouter.post("/:id/products", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const body = await c.req.json();
  const data = createProductSchema.parse({ ...body, storeId });

  const [inserted] = await db
    .insert(showroomStoreProducts)
    .values(data)
    .returning();

  c.executionCtx.waitUntil(
    (async () => {
      try {
        const agent = await getShowroomResearchAgent(c.env);
        await agent.researchProduct(inserted.id);
      } catch (error) {
        console.error(`ShowroomResearchAgent product research failed for ${inserted.id}:`, error);
      }
    })(),
  );

  return c.json({ product: inserted }, 201);
});

/**
 * PUT /:id/products/:pid — Update a product.
 */
showroomStoresRouter.put("/:id/products/:pid", async (c) => {
  const db = drizzle(c.env.DB);
  const productId = Number(c.req.param("pid"));
  const body = await c.req.json();
  const data = createProductSchema.partial().parse(body);

  const [updated] = await db
    .update(showroomStoreProducts)
    .set({ ...data, updatedAt: new Date() } as Partial<typeof showroomStoreProducts.$inferInsert>)
    .where(eq(showroomStoreProducts.id, productId))
    .returning();

  if (!updated) return c.json({ error: "Product not found" }, 404);

  return c.json({ product: updated });
});

// ─── NOTES ────────────────────────────────────────────────────────────────────

/**
 * POST /:id/notes — Add a note to a store.
 */
showroomStoresRouter.post("/:id/notes", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const { note } = await c.req.json<{ note: string }>();

  const [inserted] = await db
    .insert(storeNotes)
    .values({ storeId, note })
    .returning();

  return c.json({ note: inserted }, 201);
});

/**
 * POST /products/:pid/notes — Add a note to a product.
 */
showroomStoresRouter.post("/products/:pid/notes", async (c) => {
  const db = drizzle(c.env.DB);
  const storeProductId = Number(c.req.param("pid"));
  const { note } = await c.req.json<{ note: string }>();

  const [inserted] = await db
    .insert(storeProductNotes)
    .values({ storeProductId, note })
    .returning();

  return c.json({ note: inserted }, 201);
});

// ─── RATINGS ──────────────────────────────────────────────────────────────────

/**
 * POST /:id/rate — Rate a store (replaces existing active rating).
 */
showroomStoresRouter.post("/:id/rate", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const { rating, ratingNotes } = await c.req.json<{
    rating: number;
    ratingNotes?: string;
  }>();

  // Deactivate existing active rating
  const [existing] = await db
    .select()
    .from(storeRating)
    .where(
      and(eq(storeRating.storeId, storeId), eq(storeRating.isActive, true))
    );

  const [inserted] = await db
    .insert(storeRating)
    .values({ storeId, rating, ratingNotes } as typeof storeRating.$inferInsert)
    .returning();

  if (existing) {
    await db
      .update(storeRating)
      .set({ isActive: false, replacedById: inserted.id } as Partial<typeof storeRating.$inferInsert>)
      .where(eq(storeRating.id, existing.id));
  }

  return c.json({ rating: inserted }, 201);
});

// ─── CATEGORIES ───────────────────────────────────────────────────────────────

/**
 * GET /categories — List all categories.
 */
showroomStoresRouter.get("/meta/categories", async (c) => {
  const db = drizzle(c.env.DB);
  const categories = await db
    .select()
    .from(showroomStoreCategory)
    .where(eq(showroomStoreCategory.isActive, true));

  return c.json({ categories });
});

// ─── CITIES ───────────────────────────────────────────────────────────────────

/**
 * GET /cities — List all Bay Area cities.
 */
showroomStoresRouter.get("/meta/cities", async (c) => {
  const db = drizzle(c.env.DB);
  const cities = await db.select().from(storeBayareaCities);

  return c.json({ cities });
});

// ─── SCAN LOG ─────────────────────────────────────────────────────────────────

/**
 * GET /scan/log — List recent scan entries.
 */
showroomStoresRouter.get("/scan/log", async (c) => {
  const db = drizzle(c.env.DB);
  const limit = Number(c.req.query("limit") ?? 50);

  const scans = await db
    .select()
    .from(showroomScanLog)
    .orderBy(desc(showroomScanLog.scannedAt))
    .limit(limit);

  return c.json({ scans });
});

/**
 * POST /scan — Process a barcode scan or product image upload.
 *
 * Body: { image: string (base64 data URL), storeId?: number }
 *
 * Pipeline:
 *   1. Upload image to Cloudflare Images
 *   2. Attempt barcode decode (server-side would need wasm — for now, client sends decoded value)
 *   3. Run Workers AI VLM extraction
 *   4. Match or create product in D1
 *   5. Log to showroom_scan_log
 */
showroomStoresRouter.post("/scan", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json<{
    image?: string;
    barcodeValue?: string;
    storeId?: number;
  }>();

  try {
    let extractionStatus: "success" | "partial" | "failed" = "failed";
    let jsonExtractedData: string | null = null;
    let aiRationale: string | null = null;
    let barcodeDecodedValue = body.barcodeValue ?? null;
    let matchedStoreProductId: number | null = null;
    let autoCreatedProductId: number | null = null;
    let price: string | null = null;
    const aiModelUsed = "@cf/moonshotai/kimi-k2.6";

    // If we have a barcode value from the client-side decoder
    if (barcodeDecodedValue) {
      // Search for existing product by SKU
      const [existing] = await db
        .select()
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.sku, barcodeDecodedValue))
        .limit(1);

      if (existing) {
        matchedStoreProductId = existing.id;
        extractionStatus = "success";
        aiRationale = `Matched existing product by SKU: ${existing.itemName}`;
      }
    }

    // If we have an image and no barcode match, run VLM extraction
    if (body.image && !matchedStoreProductId) {
      try {
        const vlmResponse = await c.env.AI.run(
          "@cf/moonshotai/kimi-k2.6" as any,
          {
            messages: [
              {
                role: "system",
                content: `You are a product identification expert. Extract product details from this image. Return a JSON object with: product_name, brand, price, dimensions, color_finish, description, sku_if_visible. If you cannot identify the product, explain why.`,
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: `Identify this product and extract all visible details. Return JSON only.`,
                  },
                  {
                    type: "image_url",
                    image_url: { url: body.image },
                  },
                ],
              },
            ],
          } as any,
          { gateway: { id: c.env.AI_GATEWAY_ID } },
        );

        const rawOutput =
          typeof vlmResponse === "string"
            ? vlmResponse
            : (vlmResponse as any)?.response ?? "";

        // Clean markdown fences from AI output
        const cleaned = rawOutput
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();

        try {
          const parsed = JSON.parse(cleaned);
          jsonExtractedData = JSON.stringify(parsed);
          price = parsed.price ?? null;
          extractionStatus = "success";
          aiRationale = `VLM extracted product: ${parsed.product_name ?? "unknown"}`;

          // Auto-create product if we have a store context
          if (body.storeId && parsed.product_name) {
            const [created] = await db
              .insert(showroomStoreProducts)
              .values({
                storeId: body.storeId,
                itemName: parsed.product_name,
                description: parsed.description,
                colors: parsed.color_finish,
                sku: parsed.sku_if_visible,
                price: parsed.price,
                jsonDetails: jsonExtractedData,
              } as typeof showroomStoreProducts.$inferInsert)
              .returning();

            autoCreatedProductId = created.id;
          }
        } catch {
          extractionStatus = "partial";
          aiRationale = `VLM returned non-JSON response: ${cleaned.slice(0, 200)}`;
          jsonExtractedData = JSON.stringify({ raw_response: cleaned });
        }
      } catch (err: any) {
        extractionStatus = "failed";
        aiRationale = `VLM failed: ${err.message}`;
      }
    }

    // Always log to scan_log
    const [scanEntry] = await db
      .insert(showroomScanLog)
      .values({
        isBarcode: !!barcodeDecodedValue,
        barcodeDecodedValue,
        price,
        jsonExtractedData,
        aiRationale,
        aiModelUsed,
        extractionStatus,
        matchedStoreProductId,
        autoCreatedProductId,
        storeId: body.storeId ?? null,
      })
      .returning();

    return c.json({
      success: extractionStatus !== "failed",
      scanLogId: scanEntry.id,
      matchType: barcodeDecodedValue
        ? "barcode"
        : extractionStatus === "success"
          ? "ai_vision"
          : "failed",
      extractionStatus,
      product:
        matchedStoreProductId || autoCreatedProductId
          ? { matchedId: matchedStoreProductId, createdId: autoCreatedProductId }
          : null,
    });
  } catch (err: any) {
    console.error("Scan processing error:", err);
    return c.json({ error: "Scan processing failed", details: err.message }, 500);
  }
});

// ─── GAP ANALYSIS ─────────────────────────────────────────────────────────────

/**
 * GET /gaps — Identify product areas with no store coverage.
 *
 * Compares all active product area definitions against store→product area
 * mappings to find missing vendor categories.
 */
showroomStoresRouter.get("/meta/gaps", async (c) => {
  const db = drizzle(c.env.DB);

  // All active product areas
  const allAreas = await db
    .select()
    .from(storeProductAreaDef)
    .where(eq(storeProductAreaDef.isActive, true));

  // Product areas that have at least one store mapped
  const coveredAreas = await db
    .select({ productAreaId: storePaMapping.productAreaId })
    .from(storePaMapping);

  const coveredIds = new Set(coveredAreas.map((r) => r.productAreaId));

  const gaps = allAreas.filter((area) => !coveredIds.has(area.id));

  return c.json({
    totalAreas: allAreas.length,
    coveredAreas: coveredIds.size,
    gaps: gaps.map((area) => ({
      id: area.id,
      roomName: area.roomName,
      name: area.name,
      description: area.description,
      suggestion: `Search for ${area.name} vendors in the Bay Area`,
    })),
  });
});

// ─── PRODUCT AREAS ────────────────────────────────────────────────────────────

/**
 * GET /meta/product-areas — List all product area definitions.
 */
showroomStoresRouter.get("/meta/product-areas", async (c) => {
  const db = drizzle(c.env.DB);
  const areas = await db
    .select()
    .from(storeProductAreaDef)
    .where(eq(storeProductAreaDef.isActive, true));

  return c.json({ productAreas: areas });
});
