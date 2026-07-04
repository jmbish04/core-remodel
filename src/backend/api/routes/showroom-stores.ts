/**
 * @fileoverview Showroom Stores API
 *
 * CRUD for showroom stores, products, categories, ratings, notes,
 * scan log, cities, and gap analysis. Mounts at /api/showroom-stores.
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc, asc, and, like, inArray, sql } from "drizzle-orm";
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
  sourcingSweepSessions,
  showroomPocs,
  showroomProductMappings,
  browserRunPages,
  showroomPhotosMapping,
} from "@backend/db/schema/showroom/index";
import {
  brands,
  brandTypesDef,
  brandTypeMappings,
  showroomBrandMappings,
} from "@backend/db/schema/brands/index";
import { businessCardService } from "@backend/services/business-card";
import { ImageProcessorService } from "@backend/services/image-processor";
import { resolveCloudflareImagesCredentials, getGoogleMapsApiKey } from "@backend/utils/secrets";
import { faviconService } from "@backend/services/favicon";
import {
  generateProductDraftPrompt,
} from "@backend/ai/agents/ShowroomResearchAgent/methods";
import type { ShowroomResearchAgent } from "@backend/ai/agents/ShowroomResearchAgent";

export const showroomStoresRouter = new OpenAPIHono<{ Bindings: Env }>();

// ─── Validation Schemas ───────────────────────────────────────────────────────

/**
 * One-day hours slot.
 *
 * Both `open` and `close` are 24-hour "HH:MM" strings in local showroom time.
 * A `null` value means the showroom is closed on that day.
 */
const daySlotSchema = z
  .object({
    open: z.string(),
    close: z.string(),
  })
  .nullable();

/**
 * Structured opening hours for all 7 days of the week.
 *
 * All keys must be present. Set the value to `null` for days the showroom is
 * closed. Times must be 24-hour `"HH:MM"` strings in local showroom time.
 *
 * @example
 * ```json
 * {
 *   "mon": { "open": "09:00", "close": "17:00" },
 *   "tue": { "open": "09:00", "close": "17:00" },
 *   "wed": { "open": "09:00", "close": "17:00" },
 *   "thu": { "open": "09:00", "close": "17:00" },
 *   "fri": { "open": "09:00", "close": "17:00" },
 *   "sat": { "open": "10:00", "close": "15:00" },
 *   "sun": null
 * }
 * ```
 */
const hoursJsonSchema = z
  .object({
    mon: daySlotSchema,
    tue: daySlotSchema,
    wed: daySlotSchema,
    thu: daySlotSchema,
    fri: daySlotSchema,
    sat: daySlotSchema,
    sun: daySlotSchema,
  })
  .optional()
  .nullable();

// ─── Hours Derivation Helper ──────────────────────────────────────────────────

/**
 * Day abbreviation labels used for human-readable summary strings.
 */
const DAY_LABELS: Record<
  "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun",
  string
> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/**
 * Convert a 24-hour "HH:MM" string to a 12-hour "h:MM AM/PM" display string.
 *
 * @example
 * to12h("09:00") // "9:00 AM"
 * to12h("13:30") // "1:30 PM"
 * to12h("00:00") // "12:00 AM"
 * to12h("12:00") // "12:00 PM"
 */
function to12h(time: string): string {
  const [hStr, mStr] = time.split(":");
  const h = parseInt(hStr, 10);
  const m = mStr ?? "00";
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

/**
 * Collapse a list of same-hours consecutive days into range strings.
 *
 * For example, if Mon–Fri all share "9:00 AM–5:00 PM", this returns a single
 * "Mon–Fri 9:00 AM–5:00 PM" entry rather than five separate lines.
 * Days with different hours are listed individually.
 * Closed days (null slot) are omitted.
 *
 * @param days - Ordered list of day keys to collapse.
 * @param hoursJson - The full hoursJson object (source of truth).
 * @returns Array of human-readable strings, one per group of same-hours days.
 */
function collapseHoursGroups(
  days: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">,
  hoursJson: NonNullable<NonNullable<z.infer<typeof hoursJsonSchema>>>,
): string[] {
  // Filter to open days only.
  const openDays = days.filter((d) => hoursJson[d] !== null);
  if (openDays.length === 0) return [];

  const groups: Array<{
    label: string;
    open: string;
    close: string;
    startDay: string;
    endDay: string;
  }> = [];

  for (const day of openDays) {
    const slot = hoursJson[day]!;
    const last = groups[groups.length - 1];

    if (last && last.open === slot.open && last.close === slot.close) {
      // Extend the current range to include this day.
      last.endDay = DAY_LABELS[day];
    } else {
      // Start a new group.
      groups.push({
        label: DAY_LABELS[day],
        open: slot.open,
        close: slot.close,
        startDay: DAY_LABELS[day],
        endDay: DAY_LABELS[day],
      });
    }
  }

  return groups.map((g) => {
    const dayRange =
      g.startDay === g.endDay ? g.startDay : `${g.startDay}–${g.endDay}`;
    return `${dayRange} ${to12h(g.open)}–${to12h(g.close)}`;
  });
}

/**
 * Derive the three back-compat / filter fields from a structured `hoursJson`.
 *
 * **Derivation rules:**
 *
 * - `isOpenWeekends` — `true` when either `sat` or `sun` is non-null.
 *
 * - `weekdayHours` — A human-readable summary of Mon–Fri.  Consecutive days
 *   that share the same opening and closing time are collapsed into a range
 *   (e.g. "Mon–Fri 9:00 AM–5:00 PM").  Days with different hours are listed
 *   separately.  Closed weekdays are omitted.  Example output:
 *   `"Mon–Thu 9:00 AM–5:00 PM, Fri 9:00 AM–3:00 PM"`
 *
 * - `weekendHours` — Same treatment for Sat and Sun.  When both are closed the
 *   string is `"Closed"`.  Example: `"Sat 10:00 AM–4:00 PM"`.
 *
 * Times in `hoursJson` are 24-hour `"HH:MM"` strings; the derived summaries
 * render them as 12-hour `"h:MM AM/PM"` strings for display.
 *
 * @param hoursJson - Source-of-truth hours object with all 7 day keys.
 * @returns Object with `weekdayHours`, `weekendHours`, and `isOpenWeekends`.
 */
function deriveHoursSummary(
  hoursJson: NonNullable<NonNullable<z.infer<typeof hoursJsonSchema>>>,
): {
  weekdayHours: string;
  weekendHours: string;
  isOpenWeekends: boolean;
} {
  const weekdayGroups = collapseHoursGroups(
    ["mon", "tue", "wed", "thu", "fri"],
    hoursJson,
  );
  const weekendGroups = collapseHoursGroups(["sat", "sun"], hoursJson);

  const weekdayHours =
    weekdayGroups.length > 0 ? weekdayGroups.join(", ") : "Closed";
  const weekendHours =
    weekendGroups.length > 0 ? weekendGroups.join(", ") : "Closed";
  const isOpenWeekends = Boolean(hoursJson.sat || hoursJson.sun);

  return { weekdayHours, weekendHours, isOpenWeekends };
}

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
  /**
   * Google Places API `place_id` for this showroom. Used to prevent
   * duplicate showroom creation from the same Places selection — see
   * `showroom_stores_place_id_uniq` and the POST / dedup check below.
   */
  placeId: z.string().optional().nullable(),
  /**
   * Structured opening hours — source of truth when provided.
   *
   * When present on create or update, the server derives and overwrites
   * `weekdayHours`, `weekendHours`, and `isOpenWeekends` server-side.
   * Client-supplied values for those three fields are ignored whenever
   * `hoursJson` is also present.
   */
  hoursJson: hoursJsonSchema,
  weekdayHours: z.string().optional().nullable(),
  weekendHours: z.string().optional().nullable(),
  isOpenWeekends: z.boolean().optional().default(false),
  isAppointmentOnly: z.boolean().optional().default(false),
  isFlagshipLocation: z.boolean().optional().default(false),
  /** Indicates a warehouse-scale or unusually broad inventory. */
  isLargeSelection: z.boolean().optional(),
  /** Showroom carries exclusive, hand-selected, or made-to-order collections. */
  isBespoke: z.boolean().optional(),
  /** Showroom explicitly requires or strongly prefers trade/designer access. @deprecated Use isTradeRepRequired instead. */
  isDesignerOnly: z.boolean().optional(),
  /**
   * Google Places star rating (0–5) sourced from the Places API `rating` field.
   * Written by the scrape workflow; also accepted on intake so the form can
   * pre-populate a freshly looked-up place without waiting for a scrape cycle.
   */
  googleRating: z.number().min(0).max(5).optional().nullable(),
  /**
   * Total number of user ratings from Google Places `userRatingCount`.
   * Displayed alongside `googleRating` for credibility context.
   */
  userRatingCount: z.number().int().min(0).optional().nullable(),
  /**
   * Google's AI-generated review synopsis (plain text extracted from the
   * Places API `reviewSummary.text.text` field). Stored as a raw string so
   * the UI can render it without re-parsing the Places API shape.
   */
  reviewSummary: z.string().optional().nullable(),
  /**
   * When true, the showroom requires a trade representative introduction or
   * appointment before a homeowner can visit or access pricing.
   * Replaces the deprecated `isDesignerOnly` flag; both columns co-exist
   * during the transition to avoid breaking older callers.
   */
  isTradeRepRequired: z.boolean().optional(),
  scale: z.string().optional().nullable(),
  inventoryFocus: z.string().optional().nullable(),
  targetDemographic: z.string().optional().nullable(),
  mainPocFullname: z.string().optional().nullable(),
  mainPocPhoneNumber: z.string().optional().nullable(),
  mainPocEmailAddress: z.string().optional().nullable(),
  distanceFromSfTime: z.string().optional().nullable(),
  distanceFromSfMiles: z.string().optional().nullable(),
  locationNotes: z.string().optional().nullable(),
  /** Public Instagram profile URL for this showroom location. */
  instagramUrl: z.string().optional().nullable(),
  /**
   * Homeowner's rich overview note serialized to HTML by PlateJS.
   * Not accepted for `iconCfImagesUrl` — that column is server-managed via FaviconService.
   */
  overviewNoteHtml: z.string().optional().nullable(),
  /** The same overview note serialized to Markdown by PlateJS (portable form). */
  overviewNoteMarkdown: z.string().optional().nullable(),
  /**
   * Optional array of category IDs to attach to the store on creation.
   * Rows are inserted into `showroom_store_category_mapping` after the store
   * is persisted. This field is NOT a column on `showroom_stores` and is
   * stripped before the DB insert.
   */
  categoryIds: z.array(z.number().int()).optional().default([]),
  /**
   * Up to 5 Google Places photo objects from the intake form.
   * Each photo's media bytes are fetched, uploaded to Cloudflare Images,
   * and stored as `showroom_photos_mapping` rows in a background waitUntil.
   * The first photo (index 0) also sets `heroImageCfImagesUrl` on the store.
   * This field is NOT a column on `showroom_stores` and is stripped before
   * the DB insert.
   */
  photos: z
    .array(
      z
        .object({
          name: z.string(),
          widthPx: z.number().int().optional().nullable(),
          heightPx: z.number().int().optional().nullable(),
          authorAttributions: z
            .array(
              z
                .object({
                  displayName: z.string().optional().nullable(),
                  uri: z.string().optional().nullable(),
                  photoUri: z.string().optional().nullable(),
                })
                .passthrough(),
            )
            .optional()
            .nullable(),
          flagContentUri: z.string().optional().nullable(),
          googleMapsUri: z.string().optional().nullable(),
        })
        .passthrough(),
    )
    .max(5)
    .optional(),
  /**
   * Full structured Gemini review-insight object from the Places-details proxy.
   * Persisted verbatim to `showroom_stores.review_ai_insight` (text json column).
   * A lenient passthrough object — individual boolean columns remain authoritative
   * for filtering; this blob is display/context only.
   */
  reviewAiInsight: z.object({}).passthrough().optional().nullable(),
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
  /** FK → brands.id — nullable, server accepts null to unlink. */
  brandId: z.number().int().optional().nullable(),
  /**
   * Coarse product type / category used to group the global product list
   * (e.g. "Faucet", "Range", "Tile", "Sink"). Nullable — user-set.
   */
  productType: z.string().optional().nullable(),
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
 *
 * Ownership check: resolves the storeId from the row (via product join for
 * product scope) and confirms it maps to a real store before mutating.
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

  // ── Ownership check ───────────────────────────────────────────────────────
  // Resolve the owning storeId from the finding row so we can confirm it
  // belongs to a real store, guarding against ID-guessing across entities.
  if (scope === "product") {
    const [row] = await db
      .select({ storeId: showroomStoreProducts.storeId })
      .from(storeProductResearch)
      .innerJoin(
        showroomStoreProducts,
        eq(storeProductResearch.storeProductId, showroomStoreProducts.id),
      )
      .where(eq(storeProductResearch.id, id))
      .limit(1);
    if (!row) return c.json({ success: false, error: "Finding not found" }, 404);
  } else {
    const [row] = await db
      .select({ storeId: storeResearch.storeId })
      .from(storeResearch)
      .where(eq(storeResearch.id, id))
      .limit(1);
    if (!row) return c.json({ success: false, error: "Finding not found" }, 404);
  }

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
 *
 * Ownership check: resolves the storeId from the row (via product join for
 * product scope) and confirms it maps to a real store before mutating.
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

  // ── Ownership check ───────────────────────────────────────────────────────
  // Resolve the owning storeId from the image row to guard against
  // cross-entity ID guessing before applying the patch.
  if (scope === "product") {
    const [row] = await db
      .select({ storeId: showroomStoreProducts.storeId })
      .from(productImages)
      .innerJoin(
        showroomStoreProducts,
        eq(productImages.storeProductId, showroomStoreProducts.id),
      )
      .where(eq(productImages.id, id))
      .limit(1);
    if (!row) return c.json({ success: false, error: "Image not found" }, 404);
  } else {
    const [row] = await db
      .select({ storeId: showroomImages.storeId })
      .from(showroomImages)
      .where(eq(showroomImages.id, id))
      .limit(1);
    if (!row) return c.json({ success: false, error: "Image not found" }, 404);
  }

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

// ─── SWEEP PLAN-REVIEW (Phase 2) ──────────────────────────────────────────────
//
// Plan-gated deep sweeps: a sweep first drafts + annotates a research plan
// (sourcing_sweep_sessions), pauses for homeowner approval, then runs. The
// existing /deep-sweep routes remain for un-gated/quick sweeps.

/** Kick a plan-gated sweep for a product/store/category target. */
async function startSweepPlan(
  c: Context<{ Bindings: Env }>,
  targetType: "product" | "store" | "category",
  targetId: number,
) {
  const body = await c.req.json().catch(() => ({}));
  const agent = await getShowroomResearchAgent(c.env);
  const result = await agent.discoverSweepPlan({
    targetType,
    targetId,
    prompt: typeof body?.prompt === "string" ? body.prompt : undefined,
    maxSources: typeof body?.maxSources === "number" ? body.maxSources : undefined,
    researchMode: body?.researchMode === "quick" ? "quick" : "deep",
    enableMcpBridge: body?.enableMcpBridge === true,
    mcpServerUrl: new URL("/api/mcp", c.req.url).toString(),
  });
  return c.json({ success: true, ...result }, 202);
}

showroomStoresRouter.post("/products/:productId/research/plan", async (c) => {
  const productId = Number(c.req.param("productId"));
  if (!Number.isInteger(productId)) return c.json({ success: false, error: "Invalid product id" }, 400);
  return startSweepPlan(c, "product", productId);
});

showroomStoresRouter.post("/:id/research/plan", async (c) => {
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId)) return c.json({ success: false, error: "Invalid store id" }, 400);
  return startSweepPlan(c, "store", storeId);
});

showroomStoresRouter.post("/meta/categories/:categoryId/research/plan", async (c) => {
  const categoryId = Number(c.req.param("categoryId"));
  if (!Number.isInteger(categoryId)) return c.json({ success: false, error: "Invalid category id" }, 400);
  return startSweepPlan(c, "category", categoryId);
});

/** Poll a sweep session — plan, annotations, status, and result counts. */
showroomStoresRouter.get("/research/sweep-sessions/:sid", async (c) => {
  const db = drizzle(c.env.DB);
  const sid = Number(c.req.param("sid"));
  if (!Number.isInteger(sid)) return c.json({ success: false, error: "Invalid session id" }, 400);

  const [session] = await db
    .select()
    .from(sourcingSweepSessions)
    .where(eq(sourcingSweepSessions.id, sid))
    .limit(1);
  if (!session) return c.json({ success: false, error: "Sweep session not found" }, 404);

  return c.json({ success: true, session });
});

/** Approve the drafted plan and release the sweep. */
showroomStoresRouter.post("/research/sweep-sessions/:sid/approve-plan", async (c) => {
  const sid = Number(c.req.param("sid"));
  if (!Number.isInteger(sid)) return c.json({ success: false, error: "Invalid session id" }, 400);
  try {
    const agent = await getShowroomResearchAgent(c.env);
    const result = await agent.approveSweepPlan(sid);
    return c.json(result, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("not awaiting") || message.includes("not found") ? 409 : 500;
    return c.json({ success: false, error: message }, status);
  }
});

/** Request changes — re-draft the plan with homeowner feedback. */
showroomStoresRouter.post("/research/sweep-sessions/:sid/request-changes", async (c) => {
  const sid = Number(c.req.param("sid"));
  if (!Number.isInteger(sid)) return c.json({ success: false, error: "Invalid session id" }, 400);
  const body = await c.req.json<{ feedback?: string }>().catch(() => ({}) as { feedback?: string });
  const feedback = typeof body?.feedback === "string" ? body.feedback.trim() : undefined;
  if (!feedback) return c.json({ success: false, error: "feedback is required" }, 400);
  try {
    const agent = await getShowroomResearchAgent(c.env);
    const result = await agent.reviseSweepPlan(sid, feedback);
    return c.json(result, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("not awaiting") || message.includes("not found") ? 409 : 500;
    return c.json({ success: false, error: message }, status);
  }
});

// ─── STORES CRUD ──────────────────────────────────────────────────────────────

/**
 * GET / — List all stores with optional filters and enrichment.
 * Query params: ?city=San+Francisco&pricePoint=$$$&search=studio&hub=A
 *               &include=categories,ratings
 *
 * When `include` contains:
 *   - "categories" → each store gets `categories: string[]`
 *   - "ratings"    → each store gets `avgRating: number | null`, `ratingCount: number`
 */
showroomStoresRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const cityFilter = c.req.query("city");
  const priceFilter = c.req.query("pricePoint");
  const search = c.req.query("search");
  const hubFilter = c.req.query("hub");
  const includeParam = c.req.query("include") ?? "";
  const includes = new Set(includeParam.split(",").map((s) => s.trim()).filter(Boolean));

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
  const storeIds = rows.map((r) => r.store.id);

  // Parallel enrichment queries (only when requested and stores exist).
  //
  // Two independent rating sources are surfaced separately:
  //   - userRatingMap   → the homeowner's own visit rating (store_rating, active)
  //   - onlineRatingMap → aggregated external platform ratings (showroom_store_ratings)
  const [categoryMap, userRatingMap, onlineRatingMap] = await Promise.all([
    includes.has("categories") && storeIds.length > 0
      ? db
          .select({
            storeId: showroomStoreCategoryMapping.storeId,
            categoryName: showroomStoreCategory.name,
          })
          .from(showroomStoreCategoryMapping)
          .innerJoin(
            showroomStoreCategory,
            eq(showroomStoreCategoryMapping.categoryId, showroomStoreCategory.id)
          )
          .where(inArray(showroomStoreCategoryMapping.storeId, storeIds))
          .then((catRows) => {
            const map = new Map<number, string[]>();
            for (const r of catRows) {
              const list = map.get(r.storeId) ?? [];
              list.push(r.categoryName);
              map.set(r.storeId, list);
            }
            return map;
          })
      : Promise.resolve(new Map<number, string[]>()),
    includes.has("ratings") && storeIds.length > 0
      ? db
          .select({
            storeId: storeRating.storeId,
            rating: storeRating.rating,
          })
          .from(storeRating)
          .where(and(eq(storeRating.isActive, true), inArray(storeRating.storeId, storeIds)))
          .then((rRows) => {
            // At most one active rating per store — last write wins.
            const map = new Map<number, number>();
            for (const r of rRows) map.set(r.storeId, r.rating);
            return map;
          })
      : Promise.resolve(new Map<number, number>()),
    includes.has("ratings") && storeIds.length > 0
      ? db
          .select({
            storeId: showroomStoreRatings.storeId,
            rating: showroomStoreRatings.rating,
          })
          .from(showroomStoreRatings)
          .where(inArray(showroomStoreRatings.storeId, storeIds))
          .then((rRows) => {
            const map = new Map<number, { sum: number; count: number }>();
            for (const r of rRows) {
              const cur = map.get(r.storeId) ?? { sum: 0, count: 0 };
              cur.sum += r.rating;
              cur.count += 1;
              map.set(r.storeId, cur);
            }
            return map;
          })
      : Promise.resolve(new Map<number, { sum: number; count: number }>()),
  ]);

  return c.json({
    stores: rows.map((r) => {
      const base = {
        ...r.store,
        cityName: r.cityName,
        hubRoute: r.hubRoute,
        hubName: r.hubName,
      };

      if (includes.has("categories")) {
        (base as any).categories = categoryMap.get(r.store.id) ?? [];
      }
      if (includes.has("ratings")) {
        // Homeowner's own visit rating (null → "not yet visited" on the client).
        (base as any).userRating = userRatingMap.get(r.store.id) ?? null;

        // Aggregated online rating across external review platforms.
        const online = onlineRatingMap.get(r.store.id);
        (base as any).onlineRating = online
          ? Math.round((online.sum / online.count) * 10) / 10
          : null;
        (base as any).onlineRatingCount = online?.count ?? 0;
      }

      return base;
    }),
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
  const [products, categories, notes, ratings, externalRatings, research, tags, directBrands, productBrands] =
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
      // (a) Brands explicitly mapped via showroom_brand_mappings.
      db
        .select({
          brand: brands,
          mappingId: showroomBrandMappings.id,
          mappingCreatedAt: showroomBrandMappings.createdAt,
        })
        .from(showroomBrandMappings)
        .innerJoin(brands, eq(showroomBrandMappings.brandId, brands.id))
        .where(eq(showroomBrandMappings.showroomId, storeId))
        .orderBy(brands.name),
      // (b) Brands derived from products mapped via showroom_product_mappings.
      // Join: showroom_product_mappings → showroom_store_products.brandId → brands.
      db
        .select({
          brand: brands,
        })
        .from(showroomProductMappings)
        .innerJoin(
          showroomStoreProducts,
          eq(showroomProductMappings.productId, showroomStoreProducts.id),
        )
        .innerJoin(brands, eq(showroomStoreProducts.brandId, brands.id))
        .where(eq(showroomProductMappings.showroomId, storeId)),
    ]);

  // Build the DISTINCT UNION of (a) direct brand mappings and (b) product-derived brands.
  // De-dupe by brand id; direct mappings carry the showroom mapping metadata.
  const brandMap = new Map<number, {
    id: number; name: string; description: string | null; websiteUrl: string | null;
    instagramUrl: string | null; iconCfImagesUrl: string | null;
    createdAt: Date; updatedAt: Date;
    showroomMappingId: number | null; showroomMappingCreatedAt: Date | null;
    source: "direct" | "product";
  }>();

  for (const r of directBrands) {
    brandMap.set(r.brand.id, {
      ...r.brand,
      showroomMappingId: r.mappingId,
      showroomMappingCreatedAt: r.mappingCreatedAt,
      source: "direct",
    });
  }
  for (const r of productBrands) {
    if (!brandMap.has(r.brand.id)) {
      brandMap.set(r.brand.id, {
        ...r.brand,
        showroomMappingId: null,
        showroomMappingCreatedAt: null,
        source: "product",
      });
    }
  }

  const mergedBrands = [...brandMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

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
    brands: mergedBrands,
  });
});

/**
 * POST / — Create a new store.
 *
 * Accepts an optional `categoryIds` array. After the store row is inserted the
 * IDs are attached via `showroom_store_category_mapping`. `categoryIds` is
 * stripped from the object before the DB insert because it is not a column on
 * `showroom_stores`.
 */
showroomStoresRouter.post("/", async (c) => {
  const db = drizzle(c.env.DB);
  const body = await c.req.json();
  const data = createStoreSchema.parse(body);

  // Strip virtual fields before inserting into showroom_stores.
  // `categoryIds` and `photos` are not columns on `showroom_stores`.
  // `reviewAiInsight` IS a column but its .$type<> is tighter than z.passthrough(),
  // so we pull it out, cast it, and re-attach below.
  const { categoryIds, photos, reviewAiInsight, ...storeValues } = data;

  // When hoursJson is provided, derive the back-compat display fields
  // server-side so filters and legacy display remain correct.
  // Client-supplied weekdayHours / weekendHours / isOpenWeekends are
  // intentionally overwritten — do NOT trust them when hoursJson is present.
  if (storeValues.hoursJson != null) {
    const derived = deriveHoursSummary(storeValues.hoursJson);
    storeValues.weekdayHours = derived.weekdayHours;
    storeValues.weekendHours = derived.weekendHours;
    storeValues.isOpenWeekends = derived.isOpenWeekends;
  }

  // ── Duplicate prevention by Google Places place_id ──────────────────────
  // Pre-check before inserting: if a showroom already exists for this
  // place_id, short-circuit with 409 rather than let the unique constraint
  // fail (or worse, silently create a duplicate on a schema that lacked the
  // index). The insert below is ALSO try/catch-guarded to close the race
  // between this check and the insert.
  if (typeof data.placeId === "string" && data.placeId.length > 0) {
    const [existingByPlaceId] = await db
      .select({ id: showroomStores.id, name: showroomStores.name })
      .from(showroomStores)
      .where(eq(showroomStores.placeId, data.placeId))
      .limit(1);

    if (existingByPlaceId) {
      return c.json(
        {
          success: false,
          error: "This showroom has already been added.",
          existingId: existingByPlaceId.id,
          existingName: existingByPlaceId.name,
        },
        409,
      );
    }
  }

  let inserted: typeof showroomStores.$inferSelect;
  try {
    [inserted] = await db
      .insert(showroomStores)
      .values({
        ...storeValues,
        // Cast the lenient passthrough object to the column's typed shape.
        // The column is text-json; any JSON-serialisable object is safe at runtime.
        reviewAiInsight: (reviewAiInsight ?? null) as typeof showroomStores.$inferInsert["reviewAiInsight"],
      })
      .returning();
  } catch (err: any) {
    // Guards the race between the pre-check above and this insert (e.g. two
    // concurrent submits for the same Places selection). Only the place_id
    // unique constraint is expected to trip here.
    const message = err?.message ?? String(err);
    if (message.includes("UNIQUE") || message.toLowerCase().includes("constraint")) {
      let existingId: number | null = null;
      let existingName: string | null = null;
      if (typeof data.placeId === "string" && data.placeId.length > 0) {
        const [existingByPlaceId] = await db
          .select({ id: showroomStores.id, name: showroomStores.name })
          .from(showroomStores)
          .where(eq(showroomStores.placeId, data.placeId))
          .limit(1);
        if (existingByPlaceId) {
          existingId = existingByPlaceId.id;
          existingName = existingByPlaceId.name;
        }
      }
      return c.json(
        {
          success: false,
          error: "This showroom has already been added.",
          existingId,
          existingName,
        },
        409,
      );
    }
    console.error("[showroom-stores] POST / insert error:", err);
    return c.json({ success: false, error: "Failed to create store" }, 500);
  }

  // Attach inferred category mappings when provided.
  //
  // De-duplicate first: repeated IDs would insert duplicate rows (and trip a
  // unique constraint on the mapping table, failing the whole create). Then
  // write in chunks via db.batch() of single-row inserts so we never approach
  // Cloudflare D1's 100-bound-parameter-per-query limit on large category sets.
  if (categoryIds && categoryIds.length > 0) {
    const uniqueCategoryIds = [...new Set(categoryIds)];
    const CATEGORY_BATCH_SIZE = 50;
    for (let i = 0; i < uniqueCategoryIds.length; i += CATEGORY_BATCH_SIZE) {
      const chunk = uniqueCategoryIds.slice(i, i + CATEGORY_BATCH_SIZE);
      const stmts = chunk.map((categoryId) =>
        db.insert(showroomStoreCategoryMapping).values({
          storeId: inserted.id,
          categoryId,
        }),
      );
      // chunk is always non-empty here; cast to the non-empty tuple db.batch expects.
      await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
    }
  }

  // Fire background work: AI research + favicon hydration (if websiteUrl present).
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

  if (data.websiteUrl && data.websiteUrl.length > 0) {
    c.executionCtx.waitUntil(
      faviconService.hydrateShowroomIcon(c.env, inserted.id, data.websiteUrl),
    );

    // Post-submit website SCRAPE workflow: mint a RAG UUID, mark the store
    // "pending", then kick the ShowroomScrapeWorkflow. The workflow crawls the
    // site, archives markdown to R2, screenshots to CF Images, embeds into
    // Vectorize, extracts brands/Instagram/hours/hero, and hydrates the store.
    const ragUuid = crypto.randomUUID();
    c.executionCtx.waitUntil(
      (async () => {
        try {
          await db
            .update(showroomStores)
            .set({ ragUuid, scrapeStatus: "pending", updatedAt: new Date() })
            .where(eq(showroomStores.id, inserted.id));
          await c.env.SHOWROOM_SCRAPE_WORKFLOW.create({
            params: {
              showroomId: inserted.id,
              websiteUrl: data.websiteUrl as string,
              ragUuid,
            },
          });
        } catch (error) {
          console.error(
            `showroom scrape workflow trigger failed for ${inserted.id}:`,
            error,
          );
        }
      })(),
    );
  }

  // Fire background photo pipeline: fetch each Places photo media URL, upload
  // to Cloudflare Images, store a showroom_photos_mapping row, and set the hero
  // image from photo[0]. Error-guarded — never throws out of waitUntil.
  if (photos && photos.length > 0) {
    const storeId = inserted.id;
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const { accountId, apiTokens } = await resolveCloudflareImagesCredentials(c.env);
          if (!accountId || apiTokens.length === 0) {
            console.error(`[showroom-stores] photos pipeline: CF Images credentials missing for store ${storeId}`);
            return;
          }
          const [primaryToken, ...fallbackApiTokens] = apiTokens;
          const processor = new ImageProcessorService(c.env, accountId, primaryToken, { fallbackApiTokens });

          const mapsKey = await getGoogleMapsApiKey(c.env).catch(() => null);
          if (!mapsKey) {
            console.error(`[showroom-stores] photos pipeline: Google Maps API key missing for store ${storeId}`);
            return;
          }

          const db = drizzle(c.env.DB);
          const capped = photos.slice(0, 5);

          for (let i = 0; i < capped.length; i++) {
            const photo = capped[i];
            try {
              // Fetch the Places photo media bytes. The endpoint 302-redirects to
              // the actual image; fetch follows the redirect automatically.
              const mediaUrl = `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=1600&key=${mapsKey}`;
              const res = await fetch(mediaUrl, { signal: AbortSignal.timeout(8000) });
              if (!res.ok) {
                console.warn(`[showroom-stores] photos pipeline: non-ok response ${res.status} for photo ${i} of store ${storeId}`);
                continue;
              }
              const blob = await res.blob();

              // Upload to Cloudflare Images.
              const customId = `showroom-photo-${storeId}-${i}`;
              const filename = `showroom-${storeId}-${i}.jpg`;
              const uploadResp = await processor.uploadToCloudflareImages(blob, customId, filename);
              const url = processor.getDeliveryUrl(uploadResp, customId);

              // Store the mapping row.
              await db.insert(showroomPhotosMapping).values({
                showroomId: storeId,
                cfImagesPhotoUrl: url,
                photoName: photo.name,
                photoWidthPx: photo.widthPx ?? null,
                photoHeightPx: photo.heightPx ?? null,
                authorAttributes: photo.authorAttributions ?? null,
                flagContentUri: photo.flagContentUri ?? null,
                googleMapsUri: photo.googleMapsUri ?? null,
                sortOrder: i,
              } as typeof showroomPhotosMapping.$inferInsert);

              // Set the hero image from the first photo.
              if (i === 0) {
                await db
                  .update(showroomStores)
                  .set({ heroImageCfImagesUrl: url, updatedAt: new Date() } as Partial<typeof showroomStores.$inferInsert>)
                  .where(eq(showroomStores.id, storeId));
              }
            } catch (photoErr) {
              console.error(`[showroom-stores] photos pipeline: error on photo ${i} for store ${storeId}:`, photoErr);
              // Continue to the next photo — one failure must not abort the pipeline.
            }
          }
        } catch (pipelineErr) {
          console.error(`[showroom-stores] photos pipeline: outer error for store ${inserted.id}:`, pipelineErr);
        }
      })(),
    );
  }

  // Brand create / map / type pipeline from reviewAiInsight.brands.
  // Runs entirely in the background — never throws out of waitUntil.
  // Cap at 15 entries; dedupe by trimmed lowercase name before processing.
  const insightBrands = data.reviewAiInsight?.brands;
  if (Array.isArray(insightBrands) && insightBrands.length > 0) {
    const showroomIdForBrands = inserted.id;
    c.executionCtx.waitUntil(
      (async () => {
        try {
          const db2 = drizzle(c.env.DB);
          // Dedupe: keep first occurrence of each lowercase-trimmed name.
          const seen = new Set<string>();
          const uniqueBrands: Array<{ name: string; type: string; websiteUrl: string }> = [];
          for (const b of insightBrands) {
            if (!b || typeof b.name !== "string") continue;
            const key = b.name.trim().toLowerCase();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            uniqueBrands.push({
              name: b.name.trim(),
              type: typeof b.type === "string" ? b.type.trim() : "",
              websiteUrl: typeof b.websiteUrl === "string" ? b.websiteUrl.trim() : "",
            });
            if (uniqueBrands.length >= 15) break;
          }

          for (const { name, type, websiteUrl } of uniqueBrands) {
            try {
              // 1. Find or create the brand row.
              let brandId: number;
              const [existingBrand] = await db2
                .select({ id: brands.id })
                .from(brands)
                .where(sql`lower(${brands.name}) = lower(${name})`)
                .limit(1);

              if (existingBrand) {
                brandId = existingBrand.id;
              } else {
                const [newBrand] = await db2
                  .insert(brands)
                  .values({
                    name,
                    websiteUrl: websiteUrl || null,
                  } as typeof brands.$inferInsert)
                  .returning({ id: brands.id });
                brandId = newBrand.id;
              }

              // 2. Map the brand to this showroom (ignore duplicate).
              await db2
                .insert(showroomBrandMappings)
                .values({
                  showroomId: showroomIdForBrands,
                  brandId,
                } as typeof showroomBrandMappings.$inferInsert)
                .onConflictDoNothing();

              // 3. Find or create the type row and create the brand→type mapping.
              if (type) {
                let typeId: number;
                const [existingType] = await db2
                  .select({ id: brandTypesDef.id })
                  .from(brandTypesDef)
                  .where(sql`lower(${brandTypesDef.name}) = lower(${type})`)
                  .limit(1);

                if (existingType) {
                  typeId = existingType.id;
                } else {
                  const [newType] = await db2
                    .insert(brandTypesDef)
                    .values({
                      name: type,
                      isActive: true,
                    } as typeof brandTypesDef.$inferInsert)
                    .returning({ id: brandTypesDef.id });
                  typeId = newType.id;
                }

                await db2
                  .insert(brandTypeMappings)
                  .values({
                    brandId,
                    typeId,
                  } as typeof brandTypeMappings.$inferInsert)
                  .onConflictDoNothing();
              }
            } catch (brandErr) {
              console.error(`[showroom-stores] brand pipeline: error processing brand "${name}" for store ${showroomIdForBrands}:`, brandErr);
              // Continue — one brand failure must not abort the rest.
            }
          }
        } catch (outerErr) {
          console.error(`[showroom-stores] brand pipeline: outer error for store ${inserted.id}:`, outerErr);
        }
      })(),
    );
  }

  return c.json({ store: inserted }, 201);
});

/**
 * GET /:id/scrape — Scrape status + persisted browser-run pages for a showroom.
 *
 * Powers the viewport scrape-status badge and the results modal:
 *   {
 *     scrapeStatus: "idle"|"pending"|"running"|"complete"|"failed",
 *     ragUuid: string | null,
 *     heroImageCfImagesUrl: string | null,
 *     pages: BrowserRunPage[]   // newest first
 *   }
 */
showroomStoresRouter.get("/:id/scrape", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  const [store] = await db
    .select({
      scrapeStatus: showroomStores.scrapeStatus,
      ragUuid: showroomStores.ragUuid,
      heroImageCfImagesUrl: showroomStores.heroImageCfImagesUrl,
    })
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);

  if (!store) return c.json({ success: false, error: "Store not found" }, 404);

  const pages = await db
    .select()
    .from(browserRunPages)
    .where(eq(browserRunPages.showroomId, storeId))
    .orderBy(desc(browserRunPages.timestamp));

  return c.json({
    scrapeStatus: store.scrapeStatus,
    ragUuid: store.ragUuid,
    heroImageCfImagesUrl: store.heroImageCfImagesUrl,
    pages,
  });
});

/**
 * POST /:id/scrape — Manually (re-)trigger the scrape workflow for a showroom
 * that already has a websiteUrl. Mints a fresh ragUuid, sets status "pending",
 * and creates the workflow. Useful for retries after a "failed" run.
 */
showroomStoresRouter.post("/:id/scrape", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  const [store] = await db
    .select({ websiteUrl: showroomStores.websiteUrl })
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);

  if (!store) return c.json({ success: false, error: "Store not found" }, 404);
  if (!store.websiteUrl || store.websiteUrl.length === 0) {
    return c.json(
      { success: false, error: "Store has no websiteUrl to scrape" },
      400,
    );
  }

  const ragUuid = crypto.randomUUID();
  await db
    .update(showroomStores)
    .set({ ragUuid, scrapeStatus: "pending", updatedAt: new Date() })
    .where(eq(showroomStores.id, storeId));

  await c.env.SHOWROOM_SCRAPE_WORKFLOW.create({
    params: { showroomId: storeId, websiteUrl: store.websiteUrl, ragUuid },
  });

  return c.json({ success: true, ragUuid, scrapeStatus: "pending" }, 202);
});

/**
 * PUT /:id — Update a store.
 *
 * If the incoming `websiteUrl` is non-empty AND differs from the stored value
 * (or the store has no icon yet), we fire a favicon re-hydration in the
 * background via `waitUntil`.
 */
showroomStoresRouter.put("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const body = await c.req.json();
  const data = createStoreSchema.partial().parse(body);

  // Fetch existing row so we can compare websiteUrl + icon before updating.
  const [existing] = await db
    .select({ websiteUrl: showroomStores.websiteUrl, iconCfImagesUrl: showroomStores.iconCfImagesUrl })
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);

  if (!existing) return c.json({ error: "Store not found" }, 404);

  // When hoursJson is provided in a PUT, derive the back-compat display fields
  // server-side so filters and legacy display remain correct.
  // Client-supplied weekdayHours / weekendHours / isOpenWeekends are
  // intentionally overwritten — do NOT trust them when hoursJson is present.
  if (data.hoursJson != null) {
    const derived = deriveHoursSummary(data.hoursJson);
    data.weekdayHours = derived.weekdayHours;
    data.weekendHours = derived.weekendHours;
    data.isOpenWeekends = derived.isOpenWeekends;
  }

  // Strip virtual / specially-cast fields before the update spread.
  // reviewAiInsight needs a manual cast to match the column's .$type<> shape.
  const { categoryIds: _catIds, photos: _photos, reviewAiInsight: putInsight, ...putValues } = data;

  const [updated] = await db
    .update(showroomStores)
    .set({
      ...putValues,
      // Only include reviewAiInsight in the patch when the caller sent it.
      ...(putInsight !== undefined
        ? { reviewAiInsight: (putInsight ?? null) as typeof showroomStores.$inferInsert["reviewAiInsight"] }
        : {}),
      updatedAt: new Date(),
    } as Partial<typeof showroomStores.$inferInsert>)
    .where(eq(showroomStores.id, storeId))
    .returning();

  if (!updated) return c.json({ error: "Store not found" }, 404);

  // Trigger favicon refresh when websiteUrl changed or icon is missing.
  const incomingUrl = data.websiteUrl ?? null;
  const shouldRefreshIcon =
    incomingUrl &&
    incomingUrl.length > 0 &&
    (incomingUrl !== existing.websiteUrl || !existing.iconCfImagesUrl);

  if (shouldRefreshIcon) {
    c.executionCtx.waitUntil(
      faviconService.hydrateShowroomIcon(c.env, storeId, incomingUrl),
    );
  }

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

const placeExistsQuerySchema = z.object({
  placeId: z.string().min(1),
});

/**
 * GET /meta/place-exists — Pre-check whether a showroom already exists for a
 * given Google Places `place_id`.
 *
 * Lets the frontend warn the homeowner at Places-autocomplete selection time,
 * before they fill out the intake form and hit the POST / dedup guard.
 *
 * Query: ?placeId=<Google Places place_id>
 */
showroomStoresRouter.get("/meta/place-exists", async (c) => {
  const parsed = placeExistsQuerySchema.safeParse({
    placeId: c.req.query("placeId"),
  });
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  const db = drizzle(c.env.DB);
  const [existing] = await db
    .select({ id: showroomStores.id, name: showroomStores.name })
    .from(showroomStores)
    .where(eq(showroomStores.placeId, parsed.data.placeId))
    .limit(1);

  return c.json({
    exists: Boolean(existing),
    showroomId: existing?.id ?? null,
    name: existing?.name ?? null,
  });
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

// ─── SHOWROOM BRAND MAPPINGS ──────────────────────────────────────────────────

const storeBrandIdParamsSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
  brandId: z.string().regex(/^\d+$/).transform(Number),
});

/**
 * GET /:id/brands — List brands mapped to this showroom.
 *
 * Returns the full brand rows (including `iconCfImagesUrl`, `instagramUrl`)
 * joined from `showroom_brand_mappings` → `brands`.
 */
showroomStoresRouter.get("/:id/brands", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  const rows = await db
    .select({
      brand: brands,
      mappingId: showroomBrandMappings.id,
      mappingCreatedAt: showroomBrandMappings.createdAt,
    })
    .from(showroomBrandMappings)
    .innerJoin(brands, eq(showroomBrandMappings.brandId, brands.id))
    .where(eq(showroomBrandMappings.showroomId, storeId))
    .orderBy(brands.name);

  return c.json({
    brands: rows.map((r) => ({
      ...r.brand,
      showroomMappingId: r.mappingId,
      showroomMappingCreatedAt: r.mappingCreatedAt,
    })),
  });
});

const addShowroomBrandSchema = z.object({
  brandId: z.number().int().positive(),
});

/**
 * POST /:id/brands — Map a brand to this showroom.
 *
 * Body: { brandId: number }
 * Duplicate mappings are silently ignored (unique constraint catch).
 */
showroomStoresRouter.post("/:id/brands", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  const body = await c.req.json();
  const parsed = addShowroomBrandSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }
  const { brandId } = parsed.data;

  try {
    const [inserted] = await db
      .insert(showroomBrandMappings)
      .values({ showroomId: storeId, brandId })
      .returning();
    return c.json({ mapping: inserted }, 201);
  } catch (err: any) {
    // SQLite unique constraint violation — mapping already exists.
    if (err?.message?.includes("UNIQUE") || err?.message?.includes("unique")) {
      const [existing] = await db
        .select()
        .from(showroomBrandMappings)
        .where(
          and(
            eq(showroomBrandMappings.showroomId, storeId),
            eq(showroomBrandMappings.brandId, brandId),
          ),
        )
        .limit(1);
      return c.json({ mapping: existing, alreadyExists: true }, 200);
    }
    console.error("[showroom-stores] POST /:id/brands error:", err);
    return c.json({ success: false, error: "Failed to add brand mapping" }, 500);
  }
});

/**
 * DELETE /:id/brands/:brandId — Remove a brand mapping from a showroom.
 */
showroomStoresRouter.delete("/:id/brands/:brandId", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const brandId = Number(c.req.param("brandId"));
  if (!Number.isInteger(storeId) || !Number.isInteger(brandId)) {
    return c.json({ success: false, error: "Invalid id" }, 400);
  }

  await db
    .delete(showroomBrandMappings)
    .where(
      and(
        eq(showroomBrandMappings.showroomId, storeId),
        eq(showroomBrandMappings.brandId, brandId),
      ),
    );

  return c.json({ success: true });
});

// ─── BRAND-SCOPED PRODUCT SPLIT ───────────────────────────────────────────────
//
// The Showroom-Brand viewport needs to know which of a brand's products are
// already mapped to a given showroom (associated) and which are not (unassociated).
// A single query that joins + groups in D1 is more efficient than N+1 lookups.

/**
 * GET /:id/brands/:brandId/products — Split a brand's products into
 * associated / unassociated for this showroom.
 *
 * "Brand's products" = showroom_store_products WHERE brandId = :brandId.
 * "Associated"       = those whose id IS in showroom_product_mappings for :id.
 * "Unassociated"     = the rest.
 *
 * Each product item: { id, name, imageUrl } where imageUrl is the newest
 * productImages.deliveryUrl for that product, or null.
 *
 * Response 200:
 *   {
 *     "brandName": "Waterworks",
 *     "showroomName": "Studio Belmont SF",
 *     "associated":   [{ id, name, imageUrl }, ...],
 *     "unassociated": [{ id, name, imageUrl }, ...]
 *   }
 *
 * Response 404: brand or showroom not found.
 */
showroomStoresRouter.get("/:id/brands/:brandId/products", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const brandId = Number(c.req.param("brandId"));

  if (!Number.isInteger(storeId) || !Number.isInteger(brandId)) {
    return c.json({ success: false, error: "Invalid id" }, 400);
  }

  // Validate both the showroom and the brand exist.
  const [[store], [brand]] = await Promise.all([
    db
      .select({ id: showroomStores.id, name: showroomStores.name })
      .from(showroomStores)
      .where(eq(showroomStores.id, storeId))
      .limit(1),
    db
      .select({ id: brands.id, name: brands.name })
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1),
  ]);

  if (!store) return c.json({ success: false, error: "Showroom not found" }, 404);
  if (!brand) return c.json({ success: false, error: "Brand not found" }, 404);

  // 1. All products for this brand.
  const brandProducts = await db
    .select({
      id: showroomStoreProducts.id,
      itemName: showroomStoreProducts.itemName,
    })
    .from(showroomStoreProducts)
    .where(eq(showroomStoreProducts.brandId, brandId));

  if (brandProducts.length === 0) {
    return c.json({
      brandName: brand.name,
      showroomName: store.name,
      associated: [],
      unassociated: [],
    });
  }

  const productIds = brandProducts.map((p) => p.id);

  // 2. Which of those product IDs are already mapped to this showroom?
  const mappedRows = await db
    .select({ productId: showroomProductMappings.productId })
    .from(showroomProductMappings)
    .where(
      and(
        eq(showroomProductMappings.showroomId, storeId),
        inArray(showroomProductMappings.productId, productIds),
      ),
    );

  const mappedSet = new Set(mappedRows.map((r) => r.productId));

  // 3. Newest image per product — single query, group client-side.
  //    We select ALL product_images rows for these products and keep the one
  //    with the greatest createdAt per product. D1/SQLite does not support
  //    lateral joins, so we sort DESC and de-dupe in JS.
  const allImages = await db
    .select({
      storeProductId: productImages.storeProductId,
      deliveryUrl: productImages.deliveryUrl,
      createdAt: productImages.createdAt,
    })
    .from(productImages)
    .where(inArray(productImages.storeProductId, productIds))
    .orderBy(desc(productImages.createdAt));

  // Keep the first (newest) image per product.
  const imageMap = new Map<number, string>();
  for (const row of allImages) {
    if (!imageMap.has(row.storeProductId)) {
      imageMap.set(row.storeProductId, row.deliveryUrl);
    }
  }

  // 4. Split into associated / unassociated.
  const associated: { id: number; name: string; imageUrl: string | null }[] = [];
  const unassociated: { id: number; name: string; imageUrl: string | null }[] = [];

  for (const p of brandProducts) {
    const item = { id: p.id, name: p.itemName, imageUrl: imageMap.get(p.id) ?? null };
    if (mappedSet.has(p.id)) {
      associated.push(item);
    } else {
      unassociated.push(item);
    }
  }

  return c.json({
    brandName: brand.name,
    showroomName: store.name,
    associated,
    unassociated,
  });
});

/**
 * POST /:id/brands/:brandId/associate-all — Map every unassociated brand
 * product to this showroom in a single batched operation.
 *
 * Deduplication: existing mappings are identified first; only the delta is
 * inserted. Inserts are issued as single-row statements in db.batch() chunks
 * of 50 to stay well within D1's 100-parameter-per-query limit.
 *
 * Response 200:
 *   { "success": true, "added": <count> }
 */
showroomStoresRouter.post("/:id/brands/:brandId/associate-all", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const brandId = Number(c.req.param("brandId"));

  if (!Number.isInteger(storeId) || !Number.isInteger(brandId)) {
    return c.json({ success: false, error: "Invalid id" }, 400);
  }

  // Validate showroom and brand.
  const [[store], [brand]] = await Promise.all([
    db
      .select({ id: showroomStores.id })
      .from(showroomStores)
      .where(eq(showroomStores.id, storeId))
      .limit(1),
    db
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.id, brandId))
      .limit(1),
  ]);

  if (!store) return c.json({ success: false, error: "Showroom not found" }, 404);
  if (!brand) return c.json({ success: false, error: "Brand not found" }, 404);

  // All brand products.
  const brandProducts = await db
    .select({ id: showroomStoreProducts.id })
    .from(showroomStoreProducts)
    .where(eq(showroomStoreProducts.brandId, brandId));

  if (brandProducts.length === 0) {
    return c.json({ success: true, added: 0 });
  }

  const productIds = brandProducts.map((p) => p.id);

  // Already-mapped products for this showroom.
  const alreadyMapped = await db
    .select({ productId: showroomProductMappings.productId })
    .from(showroomProductMappings)
    .where(
      and(
        eq(showroomProductMappings.showroomId, storeId),
        inArray(showroomProductMappings.productId, productIds),
      ),
    );

  const mappedSet = new Set(alreadyMapped.map((r) => r.productId));
  const toInsert = productIds.filter((id) => !mappedSet.has(id));

  if (toInsert.length === 0) {
    return c.json({ success: true, added: 0 });
  }

  // Batch inserts in chunks of 50 (single-row statements; no risk of hitting
  // D1's 100-parameter limit since each insert binds exactly 2 values).
  const BATCH_SIZE = 50;
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const chunk = toInsert.slice(i, i + BATCH_SIZE);
    const stmts = chunk.map((productId) =>
      db
        .insert(showroomProductMappings)
        .values({ showroomId: storeId, productId }),
    );
    await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  }

  return c.json({ success: true, added: toInsert.length });
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

// ═══════════════════════════════════════════════════════════════════════════════
// ─── VISIT RATING (migration 0057 denormalized columns) ──────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// `POST /:id/rate` (above) writes to the `store_rating` history table and keeps
// the full audit trail. This `PUT /:id/visit-rating` endpoint writes the THREE
// denormalized columns on `showroom_stores` that were added in migration 0057:
//   - rating                (integer 1–5)
//   - ratingContextHtml     (PlateJS HTML)
//   - ratingContextMarkdown (PlateJS Markdown)
//
// These are displayed as the "latest visit" star badge on the showroom card
// without needing to join to `store_rating`.

/**
 * PUT /:id/visit-rating — Update the denormalized latest-visit rating snapshot.
 *
 * Request body:
 *   {
 *     "rating": 4,
 *     "ratingContextHtml": "<p>Great showroom, Waterworks display impressive.</p>",
 *     "ratingContextMarkdown": "Great showroom, Waterworks display impressive."
 *   }
 *
 * Response 200:
 *   { "store": { ...updatedStoreRow } }
 */
showroomStoresRouter.put("/:id/visit-rating", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isFinite(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const visitRatingSchema = z.object({
    rating: z.number().int().min(1).max(5),
    ratingContextHtml: z.string().optional().nullable(),
    ratingContextMarkdown: z.string().optional().nullable(),
  });

  const parsed = visitRatingSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  const [updated] = await db
    .update(showroomStores)
    .set({
      rating: parsed.data.rating,
      ratingContextHtml: parsed.data.ratingContextHtml ?? null,
      ratingContextMarkdown: parsed.data.ratingContextMarkdown ?? null,
      updatedAt: new Date(),
    } as Partial<typeof showroomStores.$inferInsert>)
    .where(eq(showroomStores.id, storeId))
    .returning();

  if (!updated) {
    return c.json({ success: false, error: "Store not found" }, 404);
  }

  return c.json({ store: updated });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── POCS ────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Points of contact captured during showroom visits (typically from business
// card scans). Each showroom may have many POCs. Soft-deleted via `isActive`.

/**
 * GET /:id/pocs — List active POCs for a showroom, newest first.
 *
 * Response 200:
 *   { "pocs": [ { id, showroomId, fullName, title, company, phone, email, website,
 *                 address, businessCardFrontUrl, businessCardBackUrl, extractedJson,
 *                 isActive, createdAt, updatedAt }, ... ] }
 */
showroomStoresRouter.get("/:id/pocs", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isFinite(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  const pocs = await db
    .select()
    .from(showroomPocs)
    .where(
      and(
        eq(showroomPocs.showroomId, storeId),
        eq(showroomPocs.isActive, true),
      ),
    )
    .orderBy(desc(showroomPocs.createdAt));

  return c.json({ pocs });
});

/**
 * POST /:id/pocs/extract-card — Upload card images + run VLM extraction.
 *
 * Accepts one or both sides of a business card as base64 data URLs. Uploads
 * each provided side to Cloudflare Images and runs Workers AI VLM extraction.
 * DOES NOT create a POC row — the client reviews the extracted data first, then
 * calls POST /:id/pocs to persist.
 *
 * Request body (at least one of frontImage / backImage required):
 *   {
 *     "frontImage": "data:image/jpeg;base64,...",
 *     "backImage":  "data:image/jpeg;base64,..."
 *   }
 *
 * Response 200:
 *   {
 *     "businessCardFrontUrl": "https://imagedelivery.net/.../public",
 *     "businessCardBackUrl":  null,
 *     "extracted": {
 *       "fullName": "Jane Smith",
 *       "title": "Senior Design Consultant",
 *       "company": "Studio Belmont",
 *       "phone": "+1 415 555 0100",
 *       "email": "jane@studiobelmont.com",
 *       "website": "https://studiobelmont.com",
 *       "address": "1234 Market St, San Francisco CA 94102"
 *     }
 *   }
 */
showroomStoresRouter.post("/:id/pocs/extract-card", async (c) => {
  const storeId = Number(c.req.param("id"));
  if (!Number.isFinite(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const extractCardSchema = z.object({
    frontImage: z.string().optional().nullable(),
    backImage: z.string().optional().nullable(),
  });

  const parsed = extractCardSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  const { frontImage, backImage } = parsed.data;

  if (!frontImage && !backImage) {
    return c.json(
      { success: false, error: "At least one of frontImage or backImage is required" },
      400,
    );
  }

  // Upload both sides in parallel (nulls are handled gracefully inside uploadCard).
  const [businessCardFrontUrl, businessCardBackUrl] = await Promise.all([
    frontImage
      ? businessCardService.uploadCard(c.env, "front", frontImage)
      : Promise.resolve(null),
    backImage
      ? businessCardService.uploadCard(c.env, "back", backImage)
      : Promise.resolve(null),
  ]);

  // Run VLM extraction. Prefer delivery URLs when available (smaller payload to
  // the AI gateway); fall back to original data URLs if upload failed.
  const extractionImages: { front?: string; back?: string } = {};
  if (frontImage) extractionImages.front = businessCardFrontUrl ?? frontImage;
  if (backImage) extractionImages.back = businessCardBackUrl ?? backImage;

  const extracted = await businessCardService.extractFromImages(c.env, extractionImages);

  return c.json({
    businessCardFrontUrl,
    businessCardBackUrl,
    extracted,
  });
});

/**
 * POST /:id/pocs — Create a new POC for a showroom.
 *
 * The client typically calls this after reviewing the output of extract-card.
 * All fields are optional — a POC can be created with just a name, or with
 * full card URLs + extracted data if the card scan succeeded.
 *
 * Request body:
 *   {
 *     "fullName": "Jane Smith",
 *     "title": "Senior Design Consultant",
 *     "company": "Studio Belmont",
 *     "phone": "+1 415 555 0100",
 *     "email": "jane@studiobelmont.com",
 *     "website": "https://studiobelmont.com",
 *     "address": "1234 Market St, San Francisco CA 94102",
 *     "businessCardFrontUrl": "https://imagedelivery.net/.../public",
 *     "businessCardBackUrl": null,
 *     "extractedJson": { ... }
 *   }
 *
 * Response 201:
 *   { "poc": { id, showroomId, fullName, ... } }
 */
showroomStoresRouter.post("/:id/pocs", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isFinite(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const createPocSchema = z.object({
    fullName: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    company: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    website: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
    businessCardFrontUrl: z.string().optional().nullable(),
    businessCardBackUrl: z.string().optional().nullable(),
    extractedJson: z.unknown().optional().nullable(),
  });

  const parsed = createPocSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  const { extractedJson, ...rest } = parsed.data;

  const [inserted] = await db
    .insert(showroomPocs)
    .values({
      showroomId: storeId,
      ...rest,
      extractedJson: extractedJson !== undefined ? extractedJson : null,
    } as typeof showroomPocs.$inferInsert)
    .returning();

  return c.json({ poc: inserted }, 201);
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── NOTES (rich titled notes, migration 0057) ───────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// The `store_notes` table was extended in migration 0057 with `title`,
// `contentHtml`, `contentMarkdown`, and `isActive` (soft-delete). The old
// `note` plain-text column is still present for backward compatibility.
//
// NOTE: `POST /:id/notes` above in the original NOTES block only accepted a
// plain `note` string. The routes here supersede that with the full rich-text
// schema. The old route is left in place for backward compatibility; these new
// routes live in a separate clearly-sectioned block.

/**
 * GET /:id/notes — List active notes for a showroom, newest first.
 *
 * Response 200:
 *   { "notes": [ { id, storeId, title, note, contentHtml, contentMarkdown,
 *                  isActive, timestamp }, ... ] }
 */
showroomStoresRouter.get("/:id/notes", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isFinite(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  const notes = await db
    .select()
    .from(storeNotes)
    .where(
      and(
        eq(storeNotes.storeId, storeId),
        eq(storeNotes.isActive, true),
      ),
    )
    .orderBy(desc(storeNotes.timestamp));

  return c.json({ notes });
});

/**
 * POST /:id/notes — Create a new titled rich note for a showroom.
 *
 * Request body:
 *   {
 *     "title": "Post-visit impressions",
 *     "contentHtml": "<p>Waterworks display was incredible.</p>",
 *     "contentMarkdown": "Waterworks display was incredible.",
 *     "note": "plain text fallback (optional)"
 *   }
 *
 * Response 201:
 *   { "note": { id, storeId, title, note, contentHtml, contentMarkdown, isActive, timestamp } }
 */
showroomStoresRouter.post("/:id/notes", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isFinite(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const createNoteSchema = z.object({
    title: z.string().optional().nullable(),
    contentHtml: z.string().optional().nullable(),
    contentMarkdown: z.string().optional().nullable(),
    note: z.string().optional().nullable(),
  });

  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  const [inserted] = await db
    .insert(storeNotes)
    .values({
      storeId,
      title: parsed.data.title ?? null,
      contentHtml: parsed.data.contentHtml ?? null,
      contentMarkdown: parsed.data.contentMarkdown ?? null,
      note: parsed.data.note ?? null,
      isActive: true,
    } as typeof storeNotes.$inferInsert)
    .returning();

  return c.json({ note: inserted }, 201);
});

/**
 * PUT /notes/:noteId — Update the title and/or rich content of a note.
 *
 * Request body (all optional; only provided fields are updated):
 *   {
 *     "title": "Updated title",
 *     "contentHtml": "<p>New content.</p>",
 *     "contentMarkdown": "New content."
 *   }
 *
 * Response 200:
 *   { "note": { ...updatedRow } }
 */
showroomStoresRouter.put("/notes/:noteId", async (c) => {
  const db = drizzle(c.env.DB);
  const noteId = Number(c.req.param("noteId"));
  if (!Number.isFinite(noteId)) {
    return c.json({ success: false, error: "Invalid note id" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const updateNoteSchema = z.object({
    title: z.string().optional().nullable(),
    contentHtml: z.string().optional().nullable(),
    contentMarkdown: z.string().optional().nullable(),
    note: z.string().optional().nullable(),
  });

  const parsed = updateNoteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  const patch: Partial<typeof storeNotes.$inferInsert> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.contentHtml !== undefined) patch.contentHtml = parsed.data.contentHtml;
  if (parsed.data.contentMarkdown !== undefined) patch.contentMarkdown = parsed.data.contentMarkdown;
  if (parsed.data.note !== undefined) patch.note = parsed.data.note;

  // Guard against an empty patch: Drizzle `.set({})` emits an empty UPDATE,
  // which is a SQL syntax error in SQLite/D1. With nothing to change, return
  // the current row (or 404 if it doesn't exist) instead of issuing the query.
  if (Object.keys(patch).length === 0) {
    const [existing] = await db
      .select()
      .from(storeNotes)
      .where(eq(storeNotes.id, noteId))
      .limit(1);
    if (!existing) {
      return c.json({ success: false, error: "Note not found" }, 404);
    }
    return c.json({ note: existing });
  }

  const [updated] = await db
    .update(storeNotes)
    .set(patch)
    .where(eq(storeNotes.id, noteId))
    .returning();

  if (!updated) {
    return c.json({ success: false, error: "Note not found" }, 404);
  }

  return c.json({ note: updated });
});

/**
 * DELETE /notes/:noteId — Soft-delete a note (sets isActive=false).
 *
 * Guards against phantom deletes: confirms the note exists before patching.
 *
 * Response 200:
 *   { "success": true }
 */
showroomStoresRouter.delete("/notes/:noteId", async (c) => {
  const db = drizzle(c.env.DB);
  const noteId = Number(c.req.param("noteId"));
  if (!Number.isFinite(noteId)) {
    return c.json({ success: false, error: "Invalid note id" }, 400);
  }

  // Guard: confirm the note exists before soft-deleting.
  const [existing] = await db
    .select({ id: storeNotes.id })
    .from(storeNotes)
    .where(eq(storeNotes.id, noteId))
    .limit(1);

  if (!existing) {
    return c.json({ success: false, error: "Note not found" }, 404);
  }

  await db
    .update(storeNotes)
    .set({ isActive: false } as Partial<typeof storeNotes.$inferInsert>)
    .where(eq(storeNotes.id, noteId));

  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── VISIT PHOTOS (showroom_images + polaroid-back note) ─────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Visit-uploaded photos are stored in `showroom_images` with imageKind='visit'.
// Each photo has a polaroid-back note (noteHtml / noteMarkdown) that can be
// added or updated after the initial upload.

/**
 * GET /:id/photos — List all images for a showroom, newest first.
 *
 * Response 200:
 *   { "photos": [ { id, storeId, sourceUrl, deliveryUrl, cfImageId, altText,
 *                   imageKind, noteHtml, noteMarkdown, reviewStatus, createdAt,
 *                   ... }, ... ] }
 */
showroomStoresRouter.get("/:id/photos", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isFinite(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  const photos = await db
    .select()
    .from(showroomImages)
    .where(eq(showroomImages.storeId, storeId))
    .orderBy(desc(showroomImages.createdAt));

  return c.json({ photos });
});

/**
 * POST /:id/photos — Upload a visit photo to Cloudflare Images and record it.
 *
 * The image is uploaded to CF Images; the resulting delivery URL is stored in
 * both `sourceUrl` and `deliveryUrl` so the row satisfies the NOT NULL on
 * `source_url`. `imageKind` is fixed to 'visit' for homeowner-uploaded images.
 *
 * Request body:
 *   {
 *     "image": "data:image/jpeg;base64,...",
 *     "altText": "Showroom entrance (optional)"
 *   }
 *
 * Response 201:
 *   { "photo": { id, storeId, sourceUrl, deliveryUrl, cfImageId, altText,
 *                imageKind, noteHtml, noteMarkdown, reviewStatus, createdAt, ... } }
 */
showroomStoresRouter.post("/:id/photos", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isFinite(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const uploadPhotoSchema = z.object({
    image: z.string().min(1),
    altText: z.string().optional().nullable(),
  });

  const parsed = uploadPhotoSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  // Upload to Cloudflare Images.
  let deliveryUrl: string;
  let cfImageId: string | null = null;
  try {
    const { accountId, apiTokens } = await resolveCloudflareImagesCredentials(c.env);
    if (!accountId || apiTokens.length === 0) {
      return c.json({ success: false, error: "Cloudflare Images credentials not configured" }, 500);
    }

    const [primaryToken, ...fallbackApiTokens] = apiTokens;
    const processor = new ImageProcessorService(c.env, accountId, primaryToken, {
      fallbackApiTokens,
    });

    // Decode dataUrl → Blob.
    const match = /^data:([^;]+);base64,(.*)$/s.exec(parsed.data.image);
    if (!match) {
      return c.json({ success: false, error: "Invalid image data URL" }, 400);
    }
    const [, mime, b64] = match;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });

    const customId = `showroom-visit-${storeId}-${crypto.randomUUID()}`;
    const uploadResponse = await processor.uploadToCloudflareImages(
      blob,
      customId,
      `visit-${storeId}.jpg`,
    );
    cfImageId = uploadResponse.result?.id ?? customId;
    deliveryUrl = processor.getDeliveryUrl(uploadResponse, customId);
  } catch (err) {
    console.error("[showroom-stores] POST /:id/photos upload error:", err);
    return c.json({ success: false, error: "Image upload failed" }, 500);
  }

  const imageInsertValues = {
    storeId,
    sourceUrl: deliveryUrl,
    deliveryUrl,
    cfImageId,
    altText: parsed.data.altText ?? null,
    imageKind: "visit" as const,
  };

  const [inserted] = await db
    .insert(showroomImages)
    .values(imageInsertValues as unknown as typeof showroomImages.$inferInsert)
    .returning();

  return c.json({ photo: inserted }, 201);
});

/**
 * PUT /photos/:imageId/note — Update the polaroid-back note on a visit photo.
 *
 * Request body:
 *   {
 *     "noteHtml": "<p>Beautiful Waterworks display.</p>",
 *     "noteMarkdown": "Beautiful Waterworks display."
 *   }
 *
 * Response 200:
 *   { "photo": { ...updatedRow } }
 */
showroomStoresRouter.put("/photos/:imageId/note", async (c) => {
  const db = drizzle(c.env.DB);
  const imageId = Number(c.req.param("imageId"));
  if (!Number.isFinite(imageId)) {
    return c.json({ success: false, error: "Invalid image id" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const noteSchema = z.object({
    noteHtml: z.string().optional().nullable(),
    noteMarkdown: z.string().optional().nullable(),
  });

  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  const [updated] = await db
    .update(showroomImages)
    .set({
      noteHtml: parsed.data.noteHtml ?? null,
      noteMarkdown: parsed.data.noteMarkdown ?? null,
      updatedAt: new Date(),
    } as Partial<typeof showroomImages.$inferInsert>)
    .where(eq(showroomImages.id, imageId))
    .returning();

  if (!updated) {
    return c.json({ success: false, error: "Image not found" }, 404);
  }

  return c.json({ photo: updated });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PRODUCT MAPPINGS (showroom_product_mappings) ─────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Many-to-many join between showroom locations and products. Used to associate
// products from the global product catalogue with a specific showroom so the
// homeowner can discover which showrooms stock a desired product.

/**
 * GET /:id/mapped-products — Products mapped to this showroom.
 *
 * Returns the full product row joined to its brand name.
 *
 * Response 200:
 *   {
 *     "mappings": [
 *       {
 *         "mappingId": 1,
 *         "mappingCreatedAt": "...",
 *         "product": { id, storeId, itemName, brandId, ... },
 *         "brandName": "Waterworks"
 *       },
 *       ...
 *     ]
 *   }
 */
showroomStoresRouter.get("/:id/mapped-products", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isFinite(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  const rows = await db
    .select({
      mappingId: showroomProductMappings.id,
      mappingCreatedAt: showroomProductMappings.createdAt,
      product: showroomStoreProducts,
      brandName: brands.name,
    })
    .from(showroomProductMappings)
    .innerJoin(
      showroomStoreProducts,
      eq(showroomProductMappings.productId, showroomStoreProducts.id),
    )
    .leftJoin(brands, eq(showroomStoreProducts.brandId, brands.id))
    .where(eq(showroomProductMappings.showroomId, storeId))
    .orderBy(desc(showroomProductMappings.createdAt));

  return c.json({
    mappings: rows.map((r) => ({
      mappingId: r.mappingId,
      mappingCreatedAt: r.mappingCreatedAt,
      product: r.product,
      brandName: r.brandName ?? null,
    })),
  });
});

/**
 * POST /:id/mapped-products — Map a product to this showroom.
 *
 * Duplicate mappings (same showroomId + productId) are silently ignored via
 * the unique constraint catch, consistent with the existing brands mapping pattern.
 *
 * Request body:
 *   { "productId": 42 }
 *
 * Response 201:
 *   { "mapping": { id, showroomId, productId, createdAt } }
 *
 * Response 200 (duplicate):
 *   { "mapping": { ... }, "alreadyExists": true }
 */
showroomStoresRouter.post("/:id/mapped-products", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isFinite(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const schema = z.object({ productId: z.number().int().positive() });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  try {
    const [inserted] = await db
      .insert(showroomProductMappings)
      .values({ showroomId: storeId, productId: parsed.data.productId })
      .returning();
    return c.json({ mapping: inserted }, 201);
  } catch (err: any) {
    // SQLite unique constraint violation — mapping already exists.
    if (err?.message?.includes("UNIQUE") || err?.message?.includes("unique")) {
      const [existing] = await db
        .select()
        .from(showroomProductMappings)
        .where(
          and(
            eq(showroomProductMappings.showroomId, storeId),
            eq(showroomProductMappings.productId, parsed.data.productId),
          ),
        )
        .limit(1);
      return c.json({ mapping: existing, alreadyExists: true }, 200);
    }
    console.error("[showroom-stores] POST /:id/mapped-products error:", err);
    return c.json({ success: false, error: "Failed to add product mapping" }, 500);
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PLACES PHOTOS GALLERY (showroom_photos_mapping) ─────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// Google Places photos that were fetched at intake time, uploaded to Cloudflare
// Images, and stored as showroom_photos_mapping rows. Sorted by sortOrder asc
// (preserves the Places API ordering, where 0 is the hero/default photo).

/**
 * GET /:id/photos-gallery — Google Places photos for a showroom.
 *
 * Response 200:
 *   {
 *     "photos": [
 *       {
 *         "id": 1,
 *         "cfImagesPhotoUrl": "https://imagedelivery.net/...",
 *         "photoName": "places/abc123/photos/xyz",
 *         "photoWidthPx": 1600,
 *         "photoHeightPx": 900,
 *         "authorAttributes": [{ "displayName": "Jane D.", "uri": "...", "photoUri": "..." }],
 *         "flagContentUri": "https://...",
 *         "googleMapsUri": "https://..."
 *       },
 *       ...
 *     ]
 *   }
 */
showroomStoresRouter.get("/:id/photos-gallery", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isFinite(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  const rows = await db
    .select({
      id: showroomPhotosMapping.id,
      cfImagesPhotoUrl: showroomPhotosMapping.cfImagesPhotoUrl,
      photoName: showroomPhotosMapping.photoName,
      photoWidthPx: showroomPhotosMapping.photoWidthPx,
      photoHeightPx: showroomPhotosMapping.photoHeightPx,
      authorAttributes: showroomPhotosMapping.authorAttributes,
      flagContentUri: showroomPhotosMapping.flagContentUri,
      googleMapsUri: showroomPhotosMapping.googleMapsUri,
    })
    .from(showroomPhotosMapping)
    .where(eq(showroomPhotosMapping.showroomId, storeId))
    .orderBy(asc(showroomPhotosMapping.sortOrder));

  return c.json({ photos: rows });
});

/**
 * DELETE /:id/mapped-products/:productId — Remove a product mapping from a showroom.
 *
 * Response 200:
 *   { "success": true }
 */
showroomStoresRouter.delete("/:id/mapped-products/:productId", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const productId = Number(c.req.param("productId"));
  if (!Number.isFinite(storeId) || !Number.isFinite(productId)) {
    return c.json({ success: false, error: "Invalid id" }, 400);
  }

  await db
    .delete(showroomProductMappings)
    .where(
      and(
        eq(showroomProductMappings.showroomId, storeId),
        eq(showroomProductMappings.productId, productId),
      ),
    );

  return c.json({ success: true });
});
