/**
 * @fileoverview Showroom Stores API
 *
 * CRUD for showroom stores, products, categories, ratings, notes,
 * scan log, cities, and gap analysis. Mounts at /api/showroom-stores.
 */

import type { ShowroomResearchAgent } from "@backend/ai/agents/ShowroomResearchAgent";
import type { Context } from "hono";

import { generateProductDraftPrompt } from "@backend/ai/agents/ShowroomResearchAgent/methods";
import { brandImages, brands, showroomBrandMappings } from "@backend/db/schema/brands/index";
import {
  showroomStores,
  showroomStoreLocations,
  showroomStoreType,
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
  storeProductIntel,
  productImages,
  productSpecs,
  showroomImages,
  showroomImageGroups,
  sourcingSweepSessions,
  showroomPocs,
  showroomProductMappings,
  browserRunPages,
  showroomPhotosMapping,
  showroomStoreHours,
  showroomStoreContacts,
  showroomStoreLinks,
  productPriceObservations,
  productShowroomPhotos,
} from "@backend/db/schema/showroom/index";
import { workerEmailInvoices } from "@backend/db/schema/emails/worker_email_invoices";
import { workerEmailInvoiceLineItems } from "@backend/db/schema/emails/worker_email_invoice_line_items";
import { deviceLocation } from "@backend/db/schema/system/device-location";
import { classifyBayAreaRegion } from "@backend/lib/bay-area-region";
import { maybeEndActiveDriveOnHomeArrival } from "@backend/services/drive-home-arrival";
import { ingestLocationFix } from "@backend/services/location/ingest";
import { businessCardService } from "@backend/services/business-card";
import { faviconService } from "@backend/services/favicon";
import { GoogleMapsService } from "@backend/services/google/maps";
import { ImageProcessorService, type PhotoMetadata } from "@backend/services/image-processor";
import {
  resolveStoreGeoPatch,
  scheduleShowroomEnrichment,
} from "@backend/services/showroom/onboarding";
import { findDuplicateStore } from "@backend/services/showroom/duplicate-check";
import {
  loadPlaceIdOwners,
  loadStoreLocationCities,
  loadStoreLocationCounts,
  loadStoreLocations,
  resolveBayAreaCityId,
} from "@backend/services/showroom/locations";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";
import {
  deriveIsOpenWeekends,
  hoursJsonToRows,
  rowsToHoursJson,
} from "@backend/utils/showroom-hours";
import {
  SHOWROOM_LINK_TYPES,
  getStoreLinks,
  getStoreLinksMap,
  getStoreWebsiteUrl,
  linksToLegacyUrls,
  replaceStoreLinks,
  type StoreLinkInput,
} from "@backend/utils/showroom-links";
import { assessIntakeQuality } from "@backend/utils/showroom-quality";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { getAgentByName } from "agents";
import { renderNoteHtml, sanitizeNoteHtml } from "@backend/services/notes/markdown";
import { eq, desc, asc, and, like, inArray, ne, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

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

// Hours conversion (hoursJsonToRows) + isOpenWeekends derivation live in
// `@backend/utils/showroom-hours` (imported above). This route no longer keeps
// a private copy — hoursJson is the write source of truth; the util derives the
// normalized showroom_store_hours rows and the isOpenWeekends flag.

/** One external link in a create/update `links` payload. */
const linkInputSchema = z.object({
  url: z.string().min(1),
  // No cast needed: SHOWROOM_LINK_TYPES is a readonly tuple, which z.enum takes
  // directly. The old `as [string, ...string[]]` widened it to plain strings and
  // threw away the union, so an unknown type would have parsed clean here.
  type: z.enum(SHOWROOM_LINK_TYPES),
  urlNotes: z.string().optional().nullable(),
});

/**
 * The `brand_images.imageKind` values worth showing in the Brands & Products
 * slideshow. `logo` is redundant with the brand icon, and `catalog`/`unknown`
 * are usually spec-sheet scans rather than something inviting to look at.
 */
const SLIDESHOW_IMAGE_KINDS = ["product", "lifestyle"] as const;

/** Per-brand slideshow cap — enough to cycle, few enough to keep the payload small. */
const MAX_SLIDESHOW_IMAGES_PER_BRAND = 6;

/**
 * Approved brand imagery keyed by brand id, newest first, for the bento
 * slideshow. Returns CF Images delivery URLs only. Brands with no usable images
 * are simply absent from the map (the tile falls back to icons/lettermarks).
 */
async function getBrandImagesMap(
  db: ReturnType<typeof drizzle>,
  brandIds: number[],
): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (brandIds.length === 0) return map;

  const rows = await chunkedByIds(brandIds, (chunk) =>
    db
      .select({
        brandId: brandImages.brandId,
        deliveryUrl: brandImages.deliveryUrl,
      })
      .from(brandImages)
      .where(
        and(
          inArray(brandImages.brandId, chunk),
          ne(brandImages.reviewStatus, "rejected"),
          inArray(brandImages.imageKind, [...SLIDESHOW_IMAGE_KINDS]),
        ),
      )
      .orderBy(desc(brandImages.id)),
  );

  for (const r of rows) {
    const list = map.get(r.brandId);
    if (!list) map.set(r.brandId, [r.deliveryUrl]);
    else if (list.length < MAX_SLIDESHOW_IMAGES_PER_BRAND) list.push(r.deliveryUrl);
  }
  return map;
}

const createStoreSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  pricePoint: z.enum(["$", "$$", "$$$", "$$$$"]).optional().nullable(),
  bayAreaCityId: z.number().optional().nullable(),
  // Business-model type — single FK to showroom_store_type. Spread straight into
  // the store insert/update like any scalar column (see PUT/POST handlers).
  typeId: z.number().int().optional().nullable(),
  locationAddress: z.string().optional().nullable(),
  // Granular address parts — usually filled by the place-import / address
  // backfill from Google Places, but accepted directly here too.
  locationStreetNumber: z.string().optional().nullable(),
  locationStreetName: z.string().optional().nullable(),
  locationCity: z.string().optional().nullable(),
  locationState: z.string().optional().nullable(),
  locationZipCode: z.string().optional().nullable(),
  phoneNumber: z.string().optional().nullable(),
  emailAddress: z.string().optional().nullable(),
  zipCode: z.string().optional().nullable(),
  googleMapsLink: z.string().optional().nullable(),
  /**
   * Geographic coordinates (from Google Places `location`). Captured on the row
   * for individual map markers + region derivation. Optional/nullable — manual
   * entries may omit them, in which case the region is derived from address/ZIP.
   */
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  /**
   * Google Places API `place_id` for this showroom. Used to prevent
   * duplicate showroom creation from the same Places selection — see
   * `showroom_stores_place_id_uniq` and the POST / dedup check below.
   */
  placeId: z.string().optional().nullable(),
  /**
   * Structured opening hours — the single write source of truth. When present
   * on create or update the worker derives everything else from it: the
   * normalized `showroom_store_hours` rows and the `isOpenWeekends` flag.
   * Callers send only this blob; a client-supplied `isOpenWeekends` is ignored
   * whenever `hoursJson` is present.
   */
  hoursJson: hoursJsonSchema,
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
  /**
   * External URLs (website + socials + misc) written to `showroom_store_links`.
   * Replaces the old flat websiteUrl / instagramUrl / facebookUrl / pinterestUrl
   * fields. Sending `links` REPLACES the store's entire link set. Omit to leave
   * links unchanged (on update); omit on create for a store with no links.
   */
  links: z.array(linkInputSchema).optional(),
  /**
   * Cloudflare Images delivery URL for the showroom's icon (favicon / logo).
   * Normally set by the FaviconService, but can be manually overridden here.
   */
  iconCfImagesUrl: z.string().optional().nullable(),
  /**
   * Cloudflare Images delivery URL for the showroom's hero banner image.
   * Normally set by the Places photo pipeline, but can be manually overridden.
   */
  heroImageCfImagesUrl: z.string().optional().nullable(),
  /** Homeowner's rich overview note serialized to HTML by PlateJS. */
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
 * Returns the product row (denormalized with brandName / storeName) plus its
 * research findings (sentiment-coded), scraped product images, extracted
 * specs, the deep-research intel row, and the homeowner's active rating.
 * Powers the product-scoped ledger, media gallery, specs panels, and the
 * ecommerce viewport ({ product, findings, specs, images, intel }).
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

  const [
    findings,
    images,
    specs,
    ratings,
    intelRows,
    storeRows,
    brandRows,
    priceObservationRows,
    photos,
  ] = await Promise.all([
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
    db
      .select()
      .from(storeProductIntel)
      .where(eq(storeProductIntel.storeProductId, productId))
      .limit(1),
    // A product has no owning store — resolve carrying showrooms via the
    // showroom_product_mappings join instead.
    db
      .select({ id: showroomStores.id, name: showroomStores.name })
      .from(showroomProductMappings)
      .innerJoin(showroomStores, eq(showroomProductMappings.showroomId, showroomStores.id))
      .where(
        and(eq(showroomProductMappings.productId, productId), eq(showroomStores.isActive, true)),
      ),
    product.brandId != null
      ? db
          .select({ id: brands.id, name: brands.name })
          .from(brands)
          .where(eq(brands.id, product.brandId))
          .limit(1)
      : Promise.resolve([] as Array<{ id: number; name: string }>),
    // Every price seen for this product (showroom / online retailer /
    // manufacturer), with the showroom name resolved when present.
    db
      .select({ obs: productPriceObservations, showroomName: showroomStores.name })
      .from(productPriceObservations)
      .leftJoin(showroomStores, eq(showroomStores.id, productPriceObservations.showroomId))
      .where(eq(productPriceObservations.productId, productId)),
    db.select().from(productShowroomPhotos).where(eq(productShowroomPhotos.productId, productId)),
  ]);

  return c.json({
    success: true,
    product: {
      ...product,
      brandName: brandRows[0]?.name ?? null,
      showrooms: storeRows,
    },
    findings,
    images,
    specs,
    priceObservations: priceObservationRows.map((r) => ({
      ...r.obs,
      showroomName: r.showroomName,
    })),
    photos,
    rating: ratings[0] ?? null,
    intel: intelRows[0] ?? null,
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
      .where(and(eq(storeRating.storeId, storeId), eq(storeRating.isActive, true))),
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

  // ── Existence check ────────────────────────────────────────────────────────
  // Confirm the finding row joins to a real product, guarding against
  // ID-guessing across entities. Products have no owning store to resolve.
  if (scope === "product") {
    const [row] = await db
      .select({ productId: showroomStoreProducts.id })
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
      : await db.update(storeResearch).set(patch).where(eq(storeResearch.id, id)).returning();

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

  // ── Existence check ────────────────────────────────────────────────────────
  // Confirm the image row joins to a real product, guarding against
  // cross-entity ID guessing before applying the patch. Products have no
  // owning store to resolve.
  if (scope === "product") {
    const [row] = await db
      .select({ productId: showroomStoreProducts.id })
      .from(productImages)
      .innerJoin(showroomStoreProducts, eq(productImages.storeProductId, showroomStoreProducts.id))
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
      ? await db.update(productImages).set(patch).where(eq(productImages.id, id)).returning()
      : await db.update(showroomImages).set(patch).where(eq(showroomImages.id, id)).returning();

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
  if (!Number.isInteger(productId))
    return c.json({ success: false, error: "Invalid product id" }, 400);
  return startSweepPlan(c, "product", productId);
});

showroomStoresRouter.post("/:id/research/plan", async (c) => {
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId)) return c.json({ success: false, error: "Invalid store id" }, 400);
  return startSweepPlan(c, "store", storeId);
});

showroomStoresRouter.post("/meta/categories/:categoryId/research/plan", async (c) => {
  const categoryId = Number(c.req.param("categoryId"));
  if (!Number.isInteger(categoryId))
    return c.json({ success: false, error: "Invalid category id" }, 400);
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
/**
 * Run an `inArray(col, ids)` select in chunks and concatenate the rows.
 *
 * Cloudflare D1 caps a query at 100 bound parameters. The showroom directory
 * holds well over 100 rows, so passing the full id list to a single `inArray`
 * blows the limit and fails the whole query at runtime (a prime cause of the
 * listing 500s). Chunk at 90 to leave headroom for other bound params.
 */
const D1_IN_CHUNK = 90;
async function chunkedByIds<T>(
  ids: number[],
  run: (chunk: number[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += D1_IN_CHUNK) {
    const rows = await run(ids.slice(i, i + D1_IN_CHUNK));
    for (const row of rows) out.push(row);
  }
  return out;
}

showroomStoresRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);
  const cityFilter = c.req.query("city");
  const priceFilter = c.req.query("pricePoint");
  const search = c.req.query("search");
  const hubFilter = c.req.query("hub");
  // Inactive (soft-deleted) stores are hidden by default; pass
  // ?includeInactive=true to include them (admin/cleanup views only).
  const includeInactive = c.req.query("includeInactive") === "true";
  const includeParam = c.req.query("include") ?? "";
  const includes = new Set(
    includeParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  let query = db
    .select({
      store: showroomStores,
      cityName: storeBayareaCities.bayAreaCityName,
      hubRoute: storeBayareaCities.hubRoute,
      hubName: storeBayareaCities.hubName,
      typeKey: showroomStoreType.key,
      typeName: showroomStoreType.displayName,
      typeColor: showroomStoreType.htmlColor,
    })
    .from(showroomStores)
    .leftJoin(storeBayareaCities, eq(showroomStores.bayAreaCityId, storeBayareaCities.id))
    .leftJoin(showroomStoreType, eq(showroomStores.typeId, showroomStoreType.id))
    .orderBy(desc(showroomStores.createdAt))
    .$dynamic();

  // Soft-deleted stores are hidden by default (directory / map / list). Only an
  // explicit ?includeInactive=true surfaces them. Pushed in first so
  // `conditions` is never empty and the and(...) below always applies.
  const conditions = includeInactive ? [] : [eq(showroomStores.isActive, true)];
  if (priceFilter) {
    conditions.push(eq(showroomStores.pricePoint, priceFilter as "$" | "$$" | "$$$" | "$$$$"));
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
  // Business-model type filter — accepts a numeric type_id. The island filters
  // client-side today, but a server filter keeps the API/MCP surface honest.
  const typeFilter = c.req.query("typeId");
  if (typeFilter && Number.isFinite(Number(typeFilter))) {
    conditions.push(eq(showroomStores.typeId, Number(typeFilter)));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  let rows: Awaited<typeof query>;
  try {
    rows = await query;
  } catch (err) {
    // The core list query is the one thing that must succeed; if it fails,
    // return a controlled JSON error instead of an unhandled 500 (a broken page
    // rather than a retryable state).
    console.error("[showroom-stores] list query failed", err);
    return c.json({ stores: [], error: "Failed to load showrooms" }, 500);
  }
  const storeIds = rows.map((r) => r.store.id);

  // Parallel enrichment queries (only when requested and stores exist).
  //
  // Two independent rating sources are surfaced separately:
  //   - userRatingMap   → the homeowner's own visit rating (store_rating, active)
  //   - onlineRatingMap → aggregated external platform ratings (showroom_store_ratings)
  const [categoryMap, userRatingMap, onlineRatingMap, hoursMap] = await Promise.all([
    includes.has("categories") && storeIds.length > 0
      ? chunkedByIds(storeIds, (chunk) =>
          db
            .select({
              storeId: showroomStoreCategoryMapping.storeId,
              categoryName: showroomStoreCategory.name,
            })
            .from(showroomStoreCategoryMapping)
            .innerJoin(
              showroomStoreCategory,
              eq(showroomStoreCategoryMapping.categoryId, showroomStoreCategory.id),
            )
            .where(inArray(showroomStoreCategoryMapping.storeId, chunk))
            // The store's is_primary category FIRST (its single directory group +
            // map-marker colour), then registration order. Backed by the real
            // is_primary flag now, not just insertion order.
            .orderBy(
              desc(showroomStoreCategoryMapping.isPrimary),
              showroomStoreCategoryMapping.id,
            ),
        )
          .then((catRows) => {
            const map = new Map<number, string[]>();
            for (const r of catRows) {
              const list = map.get(r.storeId) ?? [];
              list.push(r.categoryName);
              map.set(r.storeId, list);
            }
            return map;
          })
          .catch(() => new Map<number, string[]>())
      : Promise.resolve(new Map<number, string[]>()),
    includes.has("ratings") && storeIds.length > 0
      ? chunkedByIds(storeIds, (chunk) =>
          db
            .select({
              storeId: storeRating.storeId,
              rating: storeRating.rating,
            })
            .from(storeRating)
            .where(and(eq(storeRating.isActive, true), inArray(storeRating.storeId, chunk))),
        )
          .then((rRows) => {
            // At most one active rating per store — last write wins.
            const map = new Map<number, number>();
            for (const r of rRows) map.set(r.storeId, r.rating);
            return map;
          })
          .catch(() => new Map<number, number>())
      : Promise.resolve(new Map<number, number>()),
    includes.has("ratings") && storeIds.length > 0
      ? chunkedByIds(storeIds, (chunk) =>
          db
            .select({
              storeId: showroomStoreRatings.storeId,
              rating: showroomStoreRatings.rating,
            })
            .from(showroomStoreRatings)
            .where(inArray(showroomStoreRatings.storeId, chunk)),
        )
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
          .catch(() => new Map<number, { sum: number; count: number }>())
      : Promise.resolve(new Map<number, { sum: number; count: number }>()),
    // Normalized per-day hours for every store in the list (cards always need
    // them for open/closed status + weekend cues). One query, grouped by store.
    storeIds.length > 0
      ? chunkedByIds(storeIds, (chunk) =>
          db
            .select({
              showroomId: showroomStoreHours.showroomId,
              day: showroomStoreHours.day,
              openHour: showroomStoreHours.openHour,
              openMinute: showroomStoreHours.openMinute,
              closeHour: showroomStoreHours.closeHour,
              closeMinute: showroomStoreHours.closeMinute,
            })
            .from(showroomStoreHours)
            .where(inArray(showroomStoreHours.showroomId, chunk)),
        )
          .then((hRows) => {
            const map = new Map<number, Array<Omit<(typeof hRows)[number], "showroomId">>>();
            for (const h of hRows) {
              const { showroomId, ...row } = h;
              const list = map.get(showroomId) ?? [];
              list.push(row);
              map.set(showroomId, list);
            }
            return map;
          })
          .catch(
            () =>
              new Map<
                number,
                Array<{
                  day: string;
                  openHour: number;
                  openMinute: number;
                  closeHour: number;
                  closeMinute: number;
                }>
              >(),
          )
      : Promise.resolve(
          new Map<
            number,
            Array<{
              day: string;
              openHour: number;
              openMinute: number;
              closeHour: number;
              closeMinute: number;
            }>
          >(),
        ),
  ]);

  // External links (website + socials + misc) for every store in the list,
  // plus the derived legacy flat URL fields for back-compat with card UIs.
  const linksMap = await getStoreLinksMap(db, storeIds);

  // Multi-location summary for the directory card (0045/0047 locations). Always computed —
  // one grouped read each, cheap — so every card can show the count + sorted city chips.
  const [locationCounts, locationCities, locationsById] = await Promise.all([
    loadStoreLocationCounts(db, storeIds),
    loadStoreLocationCities(db, storeIds),
    loadStoreLocations(db, storeIds),
  ]);

  return c.json({
    stores: rows.map((r) => {
      const links = linksMap.get(r.store.id) ?? [];
      const storeHours = hoursMap.get(r.store.id) ?? [];
      // Effective region — captured store hub wins; otherwise derive it at read
      // time from the store's own coordinates / address / ZIP (cheap, no Places
      // call); finally fall back to the legacy city-derived hub.
      const derived =
        r.store.hubRoute == null
          ? classifyBayAreaRegion({
              latitude: r.store.latitude,
              longitude: r.store.longitude,
              zipCode: r.store.zipCode,
              address: r.store.locationAddress,
            })
          : null;
      const effectiveHubRoute = r.store.hubRoute ?? derived?.route ?? r.hubRoute;
      const effectiveHubName = r.store.hubName ?? derived?.name ?? r.hubName;

      const base = {
        ...r.store,
        cityName: r.cityName,
        hubRoute: effectiveHubRoute,
        hubName: effectiveHubName,
        latitude: r.store.latitude,
        longitude: r.store.longitude,
        // Normalized per-day hours (sole source of truth); hoursJson rebuilt from them.
        hours: storeHours,
        hoursJson: rowsToHoursJson(storeHours),
        // Links table is the URL source of truth; derive legacy flat fields too.
        links,
        ...linksToLegacyUrls(links),
        // Business-model type (joined from showroom_store_type) — powers the
        // color-coded badge + directory filter. typeId is already in ...r.store.
        typeKey: r.typeKey ?? null,
        typeName: r.typeName ?? null,
        typeColor: r.typeColor ?? null,
        // Multi-location summary — count + unique cities sorted asc (for the card chips).
        locationCount: locationCounts.get(r.store.id) ?? 0,
        locationCities: locationCities.get(r.store.id) ?? [],
        // Compact per-location array for the directory MAP (one pin per site) +
        // card group-by-primary. isPrimary is DERIVED (place_id-matches-parent-else-
        // lowest-id). The full DTO (address parts, notes) stays on /:id/locations —
        // do NOT fatten this list payload. Contract: docs/plans/showroom-location-contract.md.
        locations: (locationsById.get(r.store.id) ?? []).map((l) => ({
          id: l.id,
          city: l.city,
          latitude: l.latitude,
          longitude: l.longitude,
          isPrimary: l.isPrimary,
        })),
        // Distinct region hubs across ALL the brand's sites, so a multi-region
        // brand shows in EVERY region tab it has a location in — not just its
        // primary hub. Route derived per location from coords/zip. Always includes
        // the store's own effective hub. Contract: showroom-location-contract.md §5.
        hubRoutes: Array.from(
          new Set(
            [
              effectiveHubRoute,
              ...(locationsById.get(r.store.id) ?? []).map(
                (l) =>
                  classifyBayAreaRegion({
                    latitude: l.latitude,
                    longitude: l.longitude,
                    zipCode: l.zipCode,
                    address: l.city,
                  })?.route ?? null,
              ),
            ].filter((x): x is string => Boolean(x)),
          ),
        ),
      };

      if (includes.has("categories")) {
        (base as any).categories = categoryMap.get(r.store.id) ?? [];
      }
      if (includes.has("ratings")) {
        // Homeowner's own visit rating — read from the denormalized column on
        // showroom_stores (written by PUT /:id/visit-rating). The store_rating
        // table is an audit trail; the canonical "latest visit" lives here.
        (base as any).userRating = r.store.rating ?? null;

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
      typeKey: showroomStoreType.key,
      typeName: showroomStoreType.displayName,
      typeColor: showroomStoreType.htmlColor,
    })
    .from(showroomStores)
    .leftJoin(storeBayareaCities, eq(showroomStores.bayAreaCityId, storeBayareaCities.id))
    .leftJoin(showroomStoreType, eq(showroomStores.typeId, showroomStoreType.id))
    .where(eq(showroomStores.id, storeId))
    .limit(1);

  if (!store) return c.json({ error: "Store not found" }, 404);

  // Parallel data loads
  const [
    products,
    categories,
    notes,
    ratings,
    externalRatings,
    research,
    tags,
    directBrands,
    productBrands,
  ] = await Promise.all([
    // A product has no owning store — products "for" this store are those
    // carried via showroom_product_mappings.
    db
      .select({ product: showroomStoreProducts })
      .from(showroomProductMappings)
      .innerJoin(
        showroomStoreProducts,
        eq(showroomProductMappings.productId, showroomStoreProducts.id),
      )
      .where(eq(showroomProductMappings.showroomId, storeId))
      .orderBy(desc(showroomStoreProducts.createdAt))
      .then((rows) => rows.map((r) => r.product)),
    db
      .select({
        mapping: showroomStoreCategoryMapping,
        category: showroomStoreCategory,
      })
      .from(showroomStoreCategoryMapping)
      .innerJoin(
        showroomStoreCategory,
        eq(showroomStoreCategoryMapping.categoryId, showroomStoreCategory.id),
      )
      .where(eq(showroomStoreCategoryMapping.storeId, storeId)),
    db
      .select()
      .from(storeNotes)
      .where(and(eq(storeNotes.storeId, storeId), eq(storeNotes.isActive, true)))
      .orderBy(desc(storeNotes.timestamp)),
    db
      .select()
      .from(storeRating)
      .where(and(eq(storeRating.storeId, storeId), eq(storeRating.isActive, true))),
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
      .innerJoin(showroomTagDef, eq(storeTagMapping.showroomTagId, showroomTagDef.id))
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
  const brandMap = new Map<
    number,
    {
      id: number;
      name: string;
      description: string | null;
      websiteUrl: string | null;
      instagramUrl: string | null;
      iconCfImagesUrl: string | null;
      createdAt: Date;
      updatedAt: Date;
      showroomMappingId: number | null;
      showroomMappingCreatedAt: Date | null;
      source: "direct" | "product";
    }
  >();

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

  const mergedBrands = [...brandMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  // Brand imagery for the Brands & Products bento slideshow. These rows are
  // captured by the BrandResearchWorkflow's website scrape (uploaded to CF
  // Images); we surface the non-rejected ones so the tile can cycle real
  // product/lifestyle photos instead of rendering as a wall of lettermarks.
  // `catalog`/`unknown` kinds are excluded — they're usually spec-sheet
  // scans, and `logo` is already covered by the brand icon.
  const brandImageMap = await getBrandImagesMap(
    db,
    mergedBrands.map((b) => b.id),
  );
  const brandsWithImages = mergedBrands.map((b) => ({
    ...b,
    images: brandImageMap.get(b.id) ?? [],
  }));

  // Normalized per-day hours (only open days; absent day = closed).
  const hours = await db
    .select({
      day: showroomStoreHours.day,
      openHour: showroomStoreHours.openHour,
      openMinute: showroomStoreHours.openMinute,
      closeHour: showroomStoreHours.closeHour,
      closeMinute: showroomStoreHours.closeMinute,
    })
    .from(showroomStoreHours)
    .where(eq(showroomStoreHours.showroomId, storeId));

  // External links (URL source of truth) + derived legacy flat URL fields.
  const links = await getStoreLinks(db, storeId);

  // Multi-location summary so the viewport's "Locations" spot renders without a second call.
  const [detailLocCount, detailLocCities] = await Promise.all([
    loadStoreLocationCounts(db, [storeId]),
    loadStoreLocationCities(db, [storeId]),
  ]);

  const detailDerived =
    store.store.hubRoute == null
      ? classifyBayAreaRegion({
          latitude: store.store.latitude,
          longitude: store.store.longitude,
          zipCode: store.store.zipCode,
          address: store.store.locationAddress,
        })
      : null;

  return c.json({
    ...store.store,
    cityName: store.cityName,
    hubRoute: store.store.hubRoute ?? detailDerived?.route ?? store.hubRoute,
    hubName: store.store.hubName ?? detailDerived?.name ?? store.hubName,
    typeKey: store.typeKey ?? null,
    typeName: store.typeName ?? null,
    typeColor: store.typeColor ?? null,
    hours,
    hoursJson: rowsToHoursJson(hours),
    links,
    ...linksToLegacyUrls(links),
    products,
    categories: categories.map((r) => ({
      ...r.mapping,
      categoryName: r.category.name,
      categoryDescription: r.category.description,
    })),
    notes: notes.map(serializeStoreNote),
    userRating: ratings[0] ?? null,
    externalRatings,
    research,
    tags: tags.map((r) => ({
      ...r.mapping,
      tagName: r.tag.name,
      tagColor: r.tag.color,
    })),
    brands: brandsWithImages,
    locationCount: detailLocCount.get(storeId) ?? 0,
    locationCities: detailLocCities.get(storeId) ?? [],
  });
});

/**
 * GET /:id/locations — every physical site of a showroom business, for the viewport's
 * Locations modal (0045/0047). Reuses `loadStoreLocations` (derived address, city, coords,
 * placeId, googleMapsLink, hub, isPrimary), sorted by city ascending, and returns the
 * business-level phone + website + active POCs so each city tab can show contacts. Fetched
 * lazily by the modal on first open — never on page load.
 */
showroomStoresRouter.get("/:id/locations", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return c.json({ error: "Invalid store id" }, 400);
  }

  const [store] = await db
    .select({ id: showroomStores.id, phoneNumber: showroomStores.phoneNumber })
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);
  if (!store) return c.json({ error: "Store not found" }, 404);

  const locations = (await loadStoreLocations(db, [storeId]))
    .get(storeId)
    ?.slice()
    .sort((a, b) => (a.city ?? "").localeCompare(b.city ?? "")) ?? [];

  const links = await getStoreLinks(db, storeId);
  const { websiteUrl } = linksToLegacyUrls(links);

  // Per-location hours + phone (ASK #8, Phase L). Additive/nullable so a location-scoped
  // page degrades to store-level when a site has none of its own:
  //  - hours: the site's own showroom_store_hours rows, else the brand-wide (location_id
  //    IS NULL) rows.
  //  - phone: the site's GENERAL_CONTACT office line; null until a per-site general
  //    contact lands for that location.
  const hourRows = await db
    .select({
      locationId: showroomStoreHours.locationId,
      day: showroomStoreHours.day,
      openHour: showroomStoreHours.openHour,
      openMinute: showroomStoreHours.openMinute,
      closeHour: showroomStoreHours.closeHour,
      closeMinute: showroomStoreHours.closeMinute,
    })
    .from(showroomStoreHours)
    .where(eq(showroomStoreHours.showroomId, storeId))
    .all();
  const brandHours = hourRows.filter((h) => h.locationId == null);
  const hoursByLoc = new Map<number, typeof hourRows>();
  for (const h of hourRows) {
    if (h.locationId == null) continue;
    const list = hoursByLoc.get(h.locationId) ?? [];
    list.push(h);
    hoursByLoc.set(h.locationId, list);
  }

  const generalContacts = await db
    .select({
      locationId: showroomStoreContacts.locationId,
      phone: showroomStoreContacts.officePhoneNumber,
    })
    .from(showroomStoreContacts)
    .where(
      and(
        eq(showroomStoreContacts.storeId, storeId),
        eq(showroomStoreContacts.type, "GENERAL_CONTACT"),
        eq(showroomStoreContacts.isDraft, false),
      ),
    )
    .all();
  const phoneByLoc = new Map<number, string>();
  for (const g of generalContacts) {
    if (g.locationId != null && g.phone) phoneByLoc.set(g.locationId, g.phone);
  }

  const enrichedLocations = locations.map((l) => {
    const rows = hoursByLoc.get(l.id) ?? brandHours;
    return {
      ...l,
      hours: rows,
      hoursJson: rows.length ? rowsToHoursJson(rows) : null,
      phone: phoneByLoc.get(l.id) ?? null,
    };
  });

  const pocs = await db
    .select()
    .from(showroomPocs)
    .where(and(eq(showroomPocs.showroomId, storeId), eq(showroomPocs.isActive, true)))
    .all();

  return c.json({
    locations: enrichedLocations,
    storePhone: store.phoneNumber,
    storeWebsite: websiteUrl,
    pocs: pocs.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      title: p.title,
      company: p.company,
      phone: p.phone,
      email: p.email,
      website: p.website,
      address: p.address,
    })),
  });
});

/**
 * POST /:id/locations — manually add a physical site to an existing showroom (0045/0047).
 * The REST twin of the `add_showroom_location` MCP tool: structured address parts (no free-text
 * address string), optional `placeId` with a cross-table clash guard (stores + locations), and
 * returns the new location with its DERIVED `isPrimary`. Use this instead of `update_showroom`
 * (which OVERWRITES the primary) or a new store (which mints a duplicate business). Lets intake's
 * dup-warning offer "add as a location of {store}". Contract: showroom-location-contract.md §14.2.
 */
showroomStoresRouter.post("/:id/locations", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return c.json({ error: "Invalid store id" }, 400);
  }
  const [store] = await db
    .select({ id: showroomStores.id })
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);
  if (!store) return c.json({ error: "Store not found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    streetNumber?: string;
    streetName?: string;
    unit?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    latitude?: number;
    longitude?: number;
    placeId?: string;
    googleMapsLink?: string;
    notes?: string;
    notesMarkdown?: string;
    notesHtml?: string;
  };

  // Reject an empty location — need at least a place, coords, or an address part.
  const hasCoords = typeof body.latitude === "number" && typeof body.longitude === "number";
  if (!body.placeId && !body.city && !body.streetName && !hasCoords) {
    return c.json(
      { error: "Provide at least a placeId, coordinates, or a city/street for the new location." },
      400,
    );
  }

  // place_id guard. The unique index `showroom_store_locations_place_id_uniq` is
  // SINGLE-COLUMN — a Google place can exist exactly ONCE across the whole table —
  // so ANY existing owner (even this same store) is a conflict, not an allowed
  // re-add: inserting a dup would trip SQLITE_CONSTRAINT → 500. loadPlaceIdOwners
  // already scans BOTH showroom_stores and showroom_store_locations, so it's the
  // whole cross-table guard on its own. Reject with the owning store id.
  if (body.placeId) {
    const owner = (await loadPlaceIdOwners(db, [body.placeId])).get(body.placeId);
    if (owner != null) {
      return c.json(
        { error: `placeId is already registered to showroom ${owner}.`, ownerStoreId: owner },
        409,
      );
    }
  }

  const bayAreaCityId = await resolveBayAreaCityId(db, body.city ?? null);
  const [inserted] = await db
    .insert(showroomStoreLocations)
    .values({
      storeId,
      bayAreaCityId,
      streetNumber: body.streetNumber ?? null,
      streetName: body.streetName ?? null,
      unit: body.unit ?? null,
      city: body.city ?? null,
      state: body.state ?? null,
      zipCode: body.zipCode ?? null,
      latitude: hasCoords ? body.latitude! : null,
      longitude: hasCoords ? body.longitude! : null,
      placeId: body.placeId ?? null,
      googleMapsLink: body.googleMapsLink ?? null,
      notes: body.notes ?? null,
      notesMarkdown: body.notesMarkdown ?? null,
      notesHtml: body.notesHtml ?? null,
    })
    .returning();

  // Return the fresh DTO for the row we just created, with its DERIVED isPrimary
  // (adding the first site can make it primary; adding a branch usually does not).
  const dto =
    (await loadStoreLocations(db, [storeId])).get(storeId)?.find((l) => l.id === inserted.id) ?? null;
  return c.json({ location: dto }, 201);
});

/**
 * GET /:id/keeper — resolve the surviving KEEPER for a merged-away store by following the
 * `keeper_store_id` chain to its end (a keeper can itself have been merged later). Returns
 * `{ keeperStoreId: number | null }`: null when this store was never merged (it IS live, or is
 * the keeper). The store-detail PAGE uses this to 302 a deep-link on a loser id onto the live
 * keeper, so ~stale links heal instead of 404-ing. Contract: showroom-location-contract.md.
 */
showroomStoresRouter.get("/:id/keeper", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return c.json({ error: "Invalid store id" }, 400);
  }
  // Walk the chain with a visited-set guard so a (bad-data) cycle can't hang the request.
  const seen = new Set<number>();
  let current = storeId;
  let keeper: number | null = null;
  let first = true;
  while (!seen.has(current)) {
    seen.add(current);
    const [row] = await db
      .select({ keeperStoreId: showroomStores.keeperStoreId })
      .from(showroomStores)
      .where(eq(showroomStores.id, current))
      .limit(1);
    if (!row) {
      // A missing ORIGINAL id (deleted/typo'd deep-link) 404s like GET /:id, so the
      // page shows not-found rather than a silent no-redirect. A missing keeper mid
      // chain just stops (return what we have).
      if (first) return c.json({ error: "Store not found" }, 404);
      break;
    }
    first = false;
    if (row.keeperStoreId == null) break;
    keeper = row.keeperStoreId;
    current = row.keeperStoreId;
  }
  return c.json({ keeperStoreId: keeper });
});

/**
 * POST /:id/streetview-render — quota gate + usage log for a billable Street
 * View render.
 *
 * The browser detects a panorama for free via `StreetViewService.getPanorama()`
 * (NOT billed), then calls this endpoint immediately BEFORE instantiating a
 * `StreetViewPanorama` object — the one action that fires a Dynamic Street View
 * (Pro SKU) billing event. We check the `street_view` monthly cap and, when
 * under it, log the render into `google_maps_usage_log` so it counts against the
 * shared free-tier budget alongside Places/Routes.
 *
 * Returns `{ allowed:false }` (403) when over cap so the client renders nothing.
 * This is a best-effort counter: it only sees renders the client announces, but
 * our client always calls it first, so under normal flow the count is complete.
 *
 * The route sits under `/api/showroom-stores/*`, which `requireAccessAuth` gates
 * in api/index.ts — every response shape is `{ allowed, reason?, message? }`.
 */
const streetviewRenderBodySchema = z.object({
  // Bounded so a hostile client can't log-inject or bloat the usage row.
  panoId: z.string().max(256).optional(),
});

showroomStoresRouter.post("/:id/streetview-render", async (c) => {
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId) || storeId <= 0) {
    return c.json(
      { allowed: false, reason: "INVALID_ID", message: "Invalid store id." },
      400,
    );
  }

  // Validate the (optional) body through Zod rather than casting untrusted JSON.
  const parsed = streetviewRenderBodySchema.safeParse(
    (await c.req.json().catch(() => ({}))) ?? {},
  );
  if (!parsed.success) {
    return c.json(
      { allowed: false, reason: "BAD_BODY", message: "Invalid request body." },
      400,
    );
  }
  const { panoId } = parsed.data;

  const db = drizzle(c.env.DB);
  // Don't spend shared Street View budget on a store that doesn't exist — a bad
  // id would otherwise write a meaningless render row against the monthly cap.
  const [store] = await db
    .select({ id: showroomStores.id })
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);
  if (!store) {
    return c.json(
      { allowed: false, reason: "NOT_FOUND", message: "Store not found." },
      404,
    );
  }

  const maps = new GoogleMapsService(c.env);
  // ponytail: check-then-log is not atomic and D1 has no transactions, so two
  // concurrent renders can both pass the check. Acceptable here — the cap
  // (4,500) sits 500 events below Google's free-tier ceiling (5,000), which
  // absorbs any realistic race for a single-operator app. Revisit with a
  // conditional insert only if concurrency ever gets high enough to matter.
  if (!(await maps.isUnderApiQuota("street_view"))) {
    return c.json(
      { allowed: false, reason: "QUOTA_LIMIT", message: "Street View monthly cap reached." },
      403,
    );
  }

  await maps.logUsage(
    "street_view",
    { storeId, panoId },
    { ok: true },
    { endpoint: "streetview:render", statusCode: 200 },
  );

  return c.json({ allowed: true });
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
  // `categoryIds`/`photos`/`links`/`hoursJson` are NOT columns on the table —
  // hoursJson is a write payload that becomes showroom_store_hours rows below.
  // `reviewAiInsight` IS a column but its .$type<> is tighter than z.passthrough(),
  // so we pull it out, cast it, and re-attach below.
  const { categoryIds, photos, reviewAiInsight, links, hoursJson, ...storeValues } = data;

  // The website URL now lives in showroom_store_links; derive it from the
  // incoming links payload for favicon + scrape triggers below.
  const websiteUrl = links?.find((l) => l.type === "WEBSITE")?.url ?? null;

  // hoursJson is the write payload — derive isOpenWeekends from it (a
  // client-supplied isOpenWeekends is intentionally overwritten). The
  // normalized showroom_store_hours rows are written after insert below.
  if (hoursJson != null) {
    storeValues.isOpenWeekends = deriveIsOpenWeekends(hoursJson);
  }

  // Guarantee coordinates whenever a Google Place was selected. Some callers
  // (the intake form) send a `placeId` but not lat/lng; without coordinates the
  // showroom can never be pinned on the map. If they're missing, resolve them
  // server-side from the placeId here — the same source the MCP onboarding tools
  // and the backfill use — so EVERY placeId-backed create is map-ready. One
  // Places lookup, only when coordinates are actually absent (skipAi keeps it cheap).
  if (
    typeof data.placeId === "string" &&
    data.placeId.length > 0 &&
    (storeValues.latitude == null || storeValues.longitude == null)
  ) {
    try {
      const details = await new GoogleMapsService(c.env).placeDetails(data.placeId, undefined, {
        skipAi: true,
      });
      const loc = (details as { location?: { latitude?: number; longitude?: number } }).location;
      if (typeof loc?.latitude === "number") storeValues.latitude = loc.latitude;
      if (typeof loc?.longitude === "number") storeValues.longitude = loc.longitude;
    } catch (err) {
      // Non-fatal: fall through to address/ZIP-derived region below. The store
      // is still created; it just won't have a precise pin until a backfill runs.
      console.error("[showroom-stores] POST / coordinate lookup failed:", err);
    }
  }

  // Capture geo columns: pass through Places coordinates, resolve the specific
  // Bay Area CITY (a `bay_area_city_id` FK, not a free-text label) from the
  // coordinates / ZIP / address, and derive the region hub from that city so the
  // row is filter- and map-ready without a Places call on load.
  Object.assign(
    storeValues,
    await resolveStoreGeoPatch(db, {
      latitude: storeValues.latitude,
      longitude: storeValues.longitude,
      zipCode: storeValues.zipCode,
      locationAddress: storeValues.locationAddress,
      locationCity: storeValues.locationCity,
    }),
  );

  // ── Duplicate prevention ────────────────────────────────────────────────
  // Pre-check before inserting: reject if an ACTIVE showroom already matches by
  // place_id, phone, website host, or normalized address — not just place_id, so
  // a manual (no-placeId) entry can't clone an existing store either. Returns 409
  // with the existing row. The insert below is ALSO try/catch-guarded to close
  // the race between this check and the insert (the place_id unique index).
  const duplicate = await findDuplicateStore(db, {
    placeId: data.placeId,
    phoneNumber: storeValues.phoneNumber,
    websiteUrl,
    locationAddress: storeValues.locationAddress,
  });
  if (duplicate) {
    return c.json(
      {
        success: false,
        error: `This showroom already exists (matched by ${duplicate.reason}).`,
        matchedOn: duplicate.reason,
        existingId: duplicate.id,
        existingName: duplicate.name,
      },
      409,
    );
  }

  let inserted: typeof showroomStores.$inferSelect;
  try {
    [inserted] = await db
      .insert(showroomStores)
      .values({
        ...storeValues,
        // Cast the lenient passthrough object to the column's typed shape.
        // The column is text-json; any JSON-serialisable object is safe at runtime.
        reviewAiInsight: (reviewAiInsight ??
          null) as (typeof showroomStores.$inferInsert)["reviewAiInsight"],
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

  // Normalized per-day hours: one row per OPEN day in showroom_store_hours (the
  // sole store of truth the API serves + the frontend uses for status/filtering).
  // Derived from the structured hoursJson payload the intake editors send.
  if (hoursJson != null) {
    const hourRows = hoursJsonToRows(inserted.id, hoursJson);
    if (hourRows.length > 0) {
      await db
        .insert(showroomStoreHours)
        .values(hourRows as [(typeof hourRows)[number], ...(typeof hourRows)[number][]]);
    }
  }

  // External links → showroom_store_links (website + socials + misc).
  if (links && links.length > 0) {
    await replaceStoreLinks(db, inserted.id, links as StoreLinkInput[]);
  }

  // ── Data-quality guard ───────────────────────────────────────────────────
  // Audited 2026-07-16 across 146 prod stores: 86 had ZERO categories, 78 no
  // logo, and 4 carried a region ("Bay Area, CA") where a street address
  // belongs. None of it was caught here, because `locationAddress` is
  // `z.string().optional().nullable()` and `categoryIds` defaults to `[]` —
  // every one of those payloads parsed clean.
  //
  // WARN, do not block: showrooms get added from a phone mid-visit and a store
  // with a fuzzy address beats no store. Warnings ride back on the 201 so the UI
  // can surface them, and are logged so the gap is visible without re-auditing
  // the whole table.
  const qualityWarnings = assessIntakeQuality({
    name: storeValues.name,
    locationAddress: storeValues.locationAddress,
    categoryIds,
    links: links as Array<{ url: string; type: string }> | null,
    websiteUrl,
  });
  if (qualityWarnings.length > 0) {
    console.warn(
      `[showroom-stores] intake quality store=${inserted.id} "${inserted.name}": ` +
        qualityWarnings.map((w) => w.code).join(", "),
    );
  }

  // Fire the full background enrichment pipeline — AI research, favicon +
  // website scrape, the Places-photo → CF Images pipeline, and brand
  // create/map — via the shared onboarding service so this matches exactly what
  // the MCP onboarding tools run. Detached through executionCtx.waitUntil.
  scheduleShowroomEnrichment(
    c.env,
    inserted,
    {
      websiteUrl,
      photos,
      brands: (
        data.reviewAiInsight as
          | { brands?: Array<{ name?: string; type?: string; websiteUrl?: string }> }
          | null
          | undefined
      )?.brands,
    },
    (p) => c.executionCtx.waitUntil(p),
  );

  // Warnings ride on the SUCCESS response — the store is created either way; the
  // caller just learns what is thin about it.
  return c.json(
    qualityWarnings.length > 0
      ? { store: inserted, warnings: qualityWarnings }
      : { store: inserted },
    201,
  );
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
    .select({ id: showroomStores.id })
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);

  if (!store) return c.json({ success: false, error: "Store not found" }, 404);

  const websiteUrl = await getStoreWebsiteUrl(db, storeId);
  if (!websiteUrl || websiteUrl.length === 0) {
    return c.json({ success: false, error: "Store has no website link to scrape" }, 400);
  }

  const ragUuid = crypto.randomUUID();
  await db
    .update(showroomStores)
    .set({ ragUuid, scrapeStatus: "pending", updatedAt: new Date() })
    .where(eq(showroomStores.id, storeId));

  await c.env.SHOWROOM_SCRAPE_WORKFLOW.create({
    params: { showroomId: storeId, websiteUrl, ragUuid },
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

  // Fetch existing icon + the current website link so we can decide whether to
  // re-hydrate the favicon after the update.
  const [existing] = await db
    .select({ iconCfImagesUrl: showroomStores.iconCfImagesUrl })
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);

  if (!existing) return c.json({ error: "Store not found" }, 404);

  const existingWebsiteUrl = await getStoreWebsiteUrl(db, storeId);

  // hoursJson is the write payload — derive isOpenWeekends from it (a
  // client-supplied isOpenWeekends is intentionally overwritten). The normalized
  // showroom_store_hours rows are replaced after the update below.
  if (data.hoursJson != null) {
    data.isOpenWeekends = deriveIsOpenWeekends(data.hoursJson);
  }

  // Strip virtual / specially-cast fields before the update spread.
  // reviewAiInsight needs a manual cast to match the column's .$type<> shape.
  // `links` → showroom_store_links, `hoursJson` → showroom_store_hours (neither
  // is a column on showroom_stores).
  const {
    categoryIds: _catIds,
    photos: _photos,
    reviewAiInsight: putInsight,
    links: putLinks,
    hoursJson: _putHours,
    ...putValues
  } = data;

  const [updated] = await db
    .update(showroomStores)
    .set({
      ...putValues,
      // Only include reviewAiInsight in the patch when the caller sent it.
      ...(putInsight !== undefined
        ? {
            reviewAiInsight: (putInsight ??
              null) as (typeof showroomStores.$inferInsert)["reviewAiInsight"],
          }
        : {}),
      updatedAt: new Date(),
    } as Partial<typeof showroomStores.$inferInsert>)
    .where(eq(showroomStores.id, storeId))
    .returning();

  if (!updated) return c.json({ error: "Store not found" }, 404);

  // Keep the normalized showroom_hours rows in lock-step with an edited
  // hoursJson (the cards + filters read the rows, not hoursJson). Replace-all:
  // drop this store's rows and re-insert one per open day. Only runs when the
  // caller actually sent hoursJson, so other PUTs leave hours untouched.
  if (data.hoursJson != null) {
    await db.delete(showroomStoreHours).where(eq(showroomStoreHours.showroomId, storeId));
    const hourRows = hoursJsonToRows(storeId, data.hoursJson);
    if (hourRows.length > 0) {
      await db
        .insert(showroomStoreHours)
        .values(hourRows as [(typeof hourRows)[number], ...(typeof hourRows)[number][]]);
    }
  }

  // Replace the store's link set when the caller sent `links` (replace-all).
  if (putLinks !== undefined) {
    await replaceStoreLinks(db, storeId, putLinks as StoreLinkInput[]);
  }

  // Trigger favicon refresh when the website link changed or the icon is missing.
  const incomingUrl =
    putLinks !== undefined
      ? (putLinks.find((l) => l.type === "WEBSITE")?.url ?? null)
      : existingWebsiteUrl;
  const shouldRefreshIcon =
    !!incomingUrl &&
    incomingUrl.length > 0 &&
    (incomingUrl !== existingWebsiteUrl || !existing.iconCfImagesUrl);

  if (shouldRefreshIcon) {
    c.executionCtx.waitUntil(faviconService.hydrateShowroomIcon(c.env, storeId, incomingUrl));
  }

  return c.json({ store: updated });
});

/**
 * PUT /:id/categories — Replace the store's category set.
 *
 * The showroom-viewport hero's category editor calls this when the user
 * corrects an AI-assigned (or missing) category. REPLACE-ALL semantics: all
 * existing mapping rows for the store are dropped and re-inserted from the
 * supplied `categoryIds` (deduped). User-set mappings carry no `aiRationale`,
 * distinguishing them from agent-inferred rows.
 */
showroomStoresRouter.put("/:id/categories", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const body = await c.req.json();
  const { categoryIds } = z.object({ categoryIds: z.array(z.number().int()).max(50) }).parse(body);

  const [store] = await db
    .select({ id: showroomStores.id })
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);
  if (!store) return c.json({ error: "Store not found" }, 404);

  await db
    .delete(showroomStoreCategoryMapping)
    .where(eq(showroomStoreCategoryMapping.storeId, storeId));

  const uniqueIds = [...new Set(categoryIds)];
  for (const categoryId of uniqueIds) {
    await db.insert(showroomStoreCategoryMapping).values({ storeId, categoryId });
  }

  // Return the joined category rows so the client can refresh in place.
  const categories = await db
    .select({
      mapping: showroomStoreCategoryMapping,
      category: showroomStoreCategory,
    })
    .from(showroomStoreCategoryMapping)
    .innerJoin(
      showroomStoreCategory,
      eq(showroomStoreCategoryMapping.categoryId, showroomStoreCategory.id),
    )
    .where(eq(showroomStoreCategoryMapping.storeId, storeId));

  return c.json({
    categories: categories.map((r) => ({
      ...r.mapping,
      categoryName: r.category.name,
      categoryDescription: r.category.description,
    })),
  });
});

/**
 * DELETE /:id — SOFT delete a store (`is_active = 0`).
 *
 * Deliberately not a hard delete: a showroom row is the parent of notes,
 * photos, ratings, price observations, brand/product mappings and drive stops,
 * and on D1 a `DROP`/`DELETE` cascade takes those with it irreversibly. Flipping
 * the flag removes the store from every list surface while leaving the history
 * intact and the row restorable via `POST /:id/restore`.
 */
showroomStoresRouter.delete("/:id", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId)) return c.json({ error: "Invalid store id" }, 400);

  const [row] = await db
    .select({ id: showroomStores.id })
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);
  if (!row) return c.json({ error: "Store not found" }, 404);

  await db
    .update(showroomStores)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(showroomStores.id, storeId));

  return c.json({ success: true, id: storeId, isActive: false });
});

/**
 * POST /:id/restore — undo a soft delete (`is_active = 1`).
 *
 * The counterpart to DELETE above: because the row and its children were never
 * removed, restoring is a single flag flip and the store returns to every list
 * surface exactly as it was.
 */
showroomStoresRouter.post("/:id/restore", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId)) return c.json({ error: "Invalid store id" }, 400);

  const [row] = await db
    .select({ id: showroomStores.id })
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);
  if (!row) return c.json({ error: "Store not found" }, 404);

  await db
    .update(showroomStores)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(showroomStores.id, storeId));

  return c.json({ success: true, id: storeId, isActive: true });
});

// ─── HOURS ────────────────────────────────────────────────────────────────────

/**
 * PUT /:id/hours — set/correct a store's opening hours from a hoursJson payload.
 * Replaces the showroom_store_hours rows + derives is_open_weekends. For when
 * intake couldn't fill hours, or they need correcting.
 */
showroomStoresRouter.put("/:id/hours", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId)) return c.json({ error: "Invalid store id" }, 400);
  const parsed = z.object({ hoursJson: hoursJsonSchema }).safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const hoursJson = parsed.data.hoursJson;
  if (hoursJson == null) return c.json({ error: "hoursJson required" }, 400);

  await db.delete(showroomStoreHours).where(eq(showroomStoreHours.showroomId, storeId));
  const rows = hoursJsonToRows(storeId, hoursJson);
  if (rows.length > 0) {
    await db
      .insert(showroomStoreHours)
      .values(rows as [(typeof rows)[number], ...(typeof rows)[number][]]);
  }
  await db
    .update(showroomStores)
    .set({ isOpenWeekends: deriveIsOpenWeekends(hoursJson), updatedAt: new Date() })
    .where(eq(showroomStores.id, storeId));

  const written = await db
    .select({
      day: showroomStoreHours.day,
      openHour: showroomStoreHours.openHour,
      openMinute: showroomStoreHours.openMinute,
      closeHour: showroomStoreHours.closeHour,
      closeMinute: showroomStoreHours.closeMinute,
    })
    .from(showroomStoreHours)
    .where(eq(showroomStoreHours.showroomId, storeId));
  return c.json({ success: true, hours: written, hoursJson: rowsToHoursJson(written) });
});

// ─── ADDRESS ──────────────────────────────────────────────────────────────────

const addressUpdateSchema = z.object({
  locationAddress: z.string().optional().nullable(),
  locationStreetNumber: z.string().optional().nullable(),
  locationStreetName: z.string().optional().nullable(),
  locationCity: z.string().optional().nullable(),
  locationState: z.string().optional().nullable(),
  locationZipCode: z.string().optional().nullable(),
  zipCode: z.string().optional().nullable(),
  googleMapsLink: z.string().optional().nullable(),
});

/**
 * PUT /:id/address — set/correct a store's address (granular parts + formatted +
 * maps link). For when Places is wrong, the store moved, or intake missed it.
 * Only the fields sent are updated.
 */
showroomStoresRouter.put("/:id/address", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId)) return c.json({ error: "Invalid store id" }, 400);
  const parsed = addressUpdateSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const d = parsed.data;
  // Keep the two zip columns in sync when either is sent.
  const zip = d.locationZipCode ?? d.zipCode;

  // Load the current row so the city FK + region hub can be RE-RESOLVED from the
  // corrected address. Editing the address must never leave a stale city/hub
  // behind (the whole point of a correction), and a manually-entered address is
  // exactly the case the coordinate-derived hub used to misfile.
  const [current] = await db
    .select()
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);
  if (!current) return c.json({ error: "Store not found" }, 404);

  // Effective post-edit geo signals: sent value wins, else keep the stored one.
  const effAddress = d.locationAddress !== undefined ? d.locationAddress : current.locationAddress;
  const effCity = d.locationCity !== undefined ? d.locationCity : current.locationCity;
  const effZip = zip !== undefined ? zip : current.zipCode;
  const geo = await resolveStoreGeoPatch(db, {
    latitude: current.latitude,
    longitude: current.longitude,
    zipCode: effZip,
    locationAddress: effAddress,
    locationCity: effCity,
  });

  const [row] = await db
    .update(showroomStores)
    .set({
      ...(d.locationAddress !== undefined ? { locationAddress: d.locationAddress } : {}),
      ...(d.locationStreetNumber !== undefined
        ? { locationStreetNumber: d.locationStreetNumber }
        : {}),
      ...(d.locationStreetName !== undefined ? { locationStreetName: d.locationStreetName } : {}),
      ...(d.locationCity !== undefined ? { locationCity: d.locationCity } : {}),
      ...(d.locationState !== undefined ? { locationState: d.locationState } : {}),
      ...(zip !== undefined ? { locationZipCode: zip, zipCode: zip } : {}),
      ...(d.googleMapsLink !== undefined ? { googleMapsLink: d.googleMapsLink } : {}),
      // Re-derived city FK + region hub (authoritative from the corrected city).
      bayAreaCityId: geo.bayAreaCityId,
      hubRoute: geo.hubRoute,
      hubName: geo.hubName,
      updatedAt: new Date(),
    })
    .where(eq(showroomStores.id, storeId))
    .returning();
  if (!row) return c.json({ error: "Store not found" }, 404);
  return c.json({ success: true, store: row });
});

// ─── DEVICE LOCATION ────────────────────────────────────────────────────────────
// The directory reports the browser's granted geolocation here so the
// getUserLocation MCP tool can answer "showrooms near me" without a live device
// round-trip. One row per report; the tool reads the most recent.

const deviceLocationSchema = z.object({
  latitude: z.number().finite(),
  longitude: z.number().finite(),
  accuracyMeters: z.number().finite().optional().nullable(),
  address: z.string().optional().nullable(),
  source: z.enum(["browser", "phone", "manual"]).optional(),
});

/**
 * POST /device-location — record the device's last-known position (best-effort).
 *
 * Also ends the active drive when the fix says the phone got HOME for the day
 * (project address, after 15:30 local) — the same rule the Tesla park webhook
 * applies, so the drive closes out whether or not the car is the one reporting.
 */
showroomStoresRouter.post("/device-location", async (c) => {
  const db = drizzle(c.env.DB);
  const parsed = deviceLocationSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const d = parsed.data;
  const [row] = await db
    .insert(deviceLocation)
    .values({
      source: d.source ?? "browser",
      latitude: d.latitude,
      longitude: d.longitude,
      accuracyMeters: d.accuracyMeters ?? null,
      address: d.address ?? null,
    })
    .returning({ id: deviceLocation.id });

  // A device fix is inherently a "where its owner is" reading, so it counts as
  // stopped. The service itself enforces the active-drive / radius / time gates.
  const homeArrival = await maybeEndActiveDriveOnHomeArrival(c.env, {
    latitude: d.latitude,
    longitude: d.longitude,
    source: "device",
    stopped: true,
  });

  // 0032 L0: a phone fix is now a first-class location source — also run the park
  // pipeline (match a drive stop + stage a soft arrival near a showroom). Additive:
  // record:false (row inserted above) and skipHomeArrival:true (ran above). Handed
  // to waitUntil so it never blocks or drops after the response.
  c.executionCtx.waitUntil(
    ingestLocationFix(
      c.env,
      {
        source: "phone",
        latitude: d.latitude,
        longitude: d.longitude,
        accuracyMeters: d.accuracyMeters ?? null,
      },
      { record: false, skipHomeArrival: true },
    ).catch((err) => console.error("[device-location] ingest failed:", err)),
  );

  return c.json({ success: true, id: row.id, homeArrival });
});

// ─── LINKS CRUD ───────────────────────────────────────────────────────────────
// showroom_store_links: the URL source of truth (website + socials + misc).
// Bulk replace also happens via the store create/update `links` payload; these
// endpoints manage individual links from the viewport.

/** GET /:id/links — list a store's links (WEBSITE-first, then socials, OTHER). */
showroomStoresRouter.get("/:id/links", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId)) return c.json({ error: "Invalid store id" }, 400);
  return c.json({ links: await getStoreLinks(db, storeId) });
});

/** POST /:id/links — add one link. */
showroomStoresRouter.post("/:id/links", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isInteger(storeId)) return c.json({ error: "Invalid store id" }, 400);
  const parsed = linkInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const [link] = await db
    .insert(showroomStoreLinks)
    .values({
      storeId,
      url: parsed.data.url.trim(),
      type: parsed.data.type as StoreLinkInput["type"],
      urlNotes: parsed.data.urlNotes?.trim() || null,
    })
    .returning();
  return c.json({ link }, 201);
});

/** PUT /:id/links/:linkId — edit one link. */
showroomStoresRouter.put("/:id/links/:linkId", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const linkId = Number(c.req.param("linkId"));
  if (!Number.isInteger(storeId) || !Number.isInteger(linkId)) {
    return c.json({ error: "Invalid id" }, 400);
  }
  const parsed = linkInputSchema.partial().safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
  const [link] = await db
    .update(showroomStoreLinks)
    .set({
      ...(parsed.data.url !== undefined ? { url: parsed.data.url.trim() } : {}),
      ...(parsed.data.type !== undefined
        ? { type: parsed.data.type as StoreLinkInput["type"] }
        : {}),
      ...(parsed.data.urlNotes !== undefined
        ? { urlNotes: parsed.data.urlNotes?.trim() || null }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(showroomStoreLinks.id, linkId), eq(showroomStoreLinks.storeId, storeId)))
    .returning();
  if (!link) return c.json({ error: "Link not found" }, 404);
  return c.json({ link });
});

/** DELETE /:id/links/:linkId — remove one link. */
showroomStoresRouter.delete("/:id/links/:linkId", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const linkId = Number(c.req.param("linkId"));
  if (!Number.isInteger(storeId) || !Number.isInteger(linkId)) {
    return c.json({ error: "Invalid id" }, 400);
  }
  await db
    .delete(showroomStoreLinks)
    .where(and(eq(showroomStoreLinks.id, linkId), eq(showroomStoreLinks.storeId, storeId)));
  return c.json({ success: true });
});

// ─── PRODUCTS CRUD ────────────────────────────────────────────────────────────

/**
 * GET /:id/products — List products for a store.
 *
 * A product has no owning store — this returns products carried by the
 * store via `showroom_product_mappings`.
 */
showroomStoresRouter.get("/:id/products", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));

  const rows = await db
    .select({ product: showroomStoreProducts })
    .from(showroomProductMappings)
    .innerJoin(
      showroomStoreProducts,
      eq(showroomProductMappings.productId, showroomStoreProducts.id),
    )
    .where(eq(showroomProductMappings.showroomId, storeId))
    .orderBy(desc(showroomStoreProducts.createdAt));

  return c.json({ products: rows.map((r) => r.product) });
});

/**
 * POST /:id/products — Add a product to a store.
 *
 * A product is global (no owning store); this endpoint creates the row and
 * then upserts a `showroom_product_mappings` link so the store carries it.
 */
showroomStoresRouter.post("/:id/products", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const body = await c.req.json();
  const data = createProductSchema.parse(body);

  const [inserted] = await db.insert(showroomStoreProducts).values(data).returning();

  await db
    .insert(showroomProductMappings)
    .values({ showroomId: storeId, productId: inserted.id })
    .onConflictDoNothing();

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

  // Kick off the deep-research enrichment workflow (reviews, price intel,
  // brand-site scrape, photos). Fire-and-forget — a trigger failure must not
  // fail product creation.
  c.executionCtx.waitUntil(
    c.env.PRODUCT_RESEARCH_WORKFLOW.create({
      params: { storeProductId: inserted.id },
    }).catch((err: any) => console.error("[product-research] trigger failed:", err)),
  );

  return c.json({ product: inserted }, 201);
});

/**
 * POST /products/:pid/research — Manually (re)trigger the product
 * deep-research workflow for one product.
 *
 * Returns 409 when a run is already in flight (intel row status "running"),
 * otherwise marks the intel row "pending" and creates a new
 * PRODUCT_RESEARCH_WORKFLOW instance. Response: `{ success: true, queued: true }`.
 */
showroomStoresRouter.post("/products/:pid/research", async (c) => {
  const db = drizzle(c.env.DB);
  const productId = Number(c.req.param("pid"));
  if (!Number.isInteger(productId)) {
    return c.json({ success: false, error: "Invalid product id" }, 400);
  }

  const [product] = await db
    .select({ id: showroomStoreProducts.id })
    .from(showroomStoreProducts)
    .where(eq(showroomStoreProducts.id, productId))
    .limit(1);

  if (!product) {
    return c.json({ success: false, error: "Product not found" }, 404);
  }

  const [intel] = await db
    .select({ researchStatus: storeProductIntel.researchStatus })
    .from(storeProductIntel)
    .where(eq(storeProductIntel.storeProductId, productId))
    .limit(1);

  if (intel?.researchStatus === "running") {
    return c.json({ success: false, error: "Product research is already running" }, 409);
  }

  // Reflect the queued state immediately so the UI shows progress before the
  // workflow's own mark-running step lands.
  await db
    .insert(storeProductIntel)
    .values({ storeProductId: productId, researchStatus: "pending" })
    .onConflictDoUpdate({
      target: storeProductIntel.storeProductId,
      set: { researchStatus: "pending", updatedAt: new Date() },
    });

  await c.env.PRODUCT_RESEARCH_WORKFLOW.create({
    params: { storeProductId: productId },
  });

  return c.json({ success: true, queued: true });
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

// NOTE: the legacy plain-`{note}` POST /:id/notes handler that used to live here
// shadowed the rich handler below (Hono dispatches to the FIRST registration),
// silently dropping title/content/tags on create. The rich handler accepts the
// legacy `note` field too, so the duplicate was removed (2026-07-07).

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
    .where(and(eq(storeRating.storeId, storeId), eq(storeRating.isActive, true)));

  const [inserted] = await db
    .insert(storeRating)
    .values({ storeId, rating, ratingNotes } as typeof storeRating.$inferInsert)
    .returning();

  if (existing) {
    await db
      .update(storeRating)
      .set({ isActive: false, replacedById: inserted.id } as Partial<
        typeof storeRating.$inferInsert
      >)
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

/**
 * GET /meta/types — active business-model types (showroom_store_type).
 * Feeds the directory type filter and the store type-edit modal. Active only:
 * a retired type stays valid on stores that already point at it but never
 * appears as a selectable option.
 */
showroomStoresRouter.get("/meta/types", async (c) => {
  const db = drizzle(c.env.DB);
  const types = await db
    .select()
    .from(showroomStoreType)
    .where(eq(showroomStoreType.isActive, true))
    .orderBy(showroomStoreType.displayName);

  return c.json({ types });
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
          typeof vlmResponse === "string" ? vlmResponse : ((vlmResponse as any)?.response ?? "");

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

          // Auto-create product (global catalog) if we have a store context,
          // then link it to that showroom via showroom_product_mappings.
          if (body.storeId && parsed.product_name) {
            const [created] = await db
              .insert(showroomStoreProducts)
              .values({
                itemName: parsed.product_name,
                description: parsed.description,
                colors: parsed.color_finish,
                sku: parsed.sku_if_visible,
                price: parsed.price,
                jsonDetails: jsonExtractedData,
              } as typeof showroomStoreProducts.$inferInsert)
              .returning();

            autoCreatedProductId = created.id;

            await db
              .insert(showroomProductMappings)
              .values({ showroomId: body.storeId, productId: created.id })
              .onConflictDoNothing();
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
    db.select({ id: brands.id }).from(brands).where(eq(brands.id, brandId)).limit(1),
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
      db.insert(showroomProductMappings).values({ showroomId: storeId, productId }),
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

  // Sanitize PlateJS HTML — the editor sometimes serialises whitespace as
  // numeric HTML entities (&#x20;, &#xa0;, etc.) which get double-encoded in
  // the DB and render as visible text on the frontend.
  let cleanHtml = parsed.data.ratingContextHtml ?? null;
  if (cleanHtml) {
    cleanHtml = cleanHtml
      .replace(/&#x20;/gi, " ")
      .replace(/&#xa0;/gi, " ")
      .replace(/&#160;/gi, " ")
      .replace(/&#32;/gi, " ")
      // Collapse trailing whitespace before closing tags.
      .replace(/\s+(<\/[^>]+>)/g, "$1")
      // Strip empty paragraphs that are just whitespace.
      .replace(/<p>\s*<\/p>/g, "");
  }

  const [updated] = await db
    .update(showroomStores)
    .set({
      rating: parsed.data.rating,
      ratingContextHtml: cleanHtml,
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
    .where(and(eq(showroomPocs.showroomId, storeId), eq(showroomPocs.isActive, true)))
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
    frontImage ? businessCardService.uploadCard(c.env, "front", frontImage) : Promise.resolve(null),
    backImage ? businessCardService.uploadCard(c.env, "back", backImage) : Promise.resolve(null),
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

/**
 * PUT /:id/pocs/:pocId — Update an existing POC.
 *
 * Request body: same shape as POST /:id/pocs (all fields optional).
 * Response 200:
 *   { "poc": { ...updatedRow } }
 */
showroomStoresRouter.put("/:id/pocs/:pocId", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const pocId = Number(c.req.param("pocId"));
  if (!Number.isFinite(storeId) || !Number.isFinite(pocId)) {
    return c.json({ success: false, error: "Invalid id" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const updatePocSchema = z.object({
    fullName: z.string().optional().nullable(),
    title: z.string().optional().nullable(),
    company: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    email: z.string().optional().nullable(),
    website: z.string().optional().nullable(),
    address: z.string().optional().nullable(),
  });

  const parsed = updatePocSchema.safeParse(body);
  if (!parsed.success) return c.json({ success: false, error: parsed.error.message }, 400);

  const [updated] = await db
    .update(showroomPocs)
    .set({ ...parsed.data, updatedAt: new Date() } as Partial<typeof showroomPocs.$inferInsert>)
    .where(and(eq(showroomPocs.id, pocId), eq(showroomPocs.showroomId, storeId)))
    .returning();

  if (!updated) return c.json({ success: false, error: "POC not found" }, 404);
  return c.json({ poc: updated });
});

/**
 * DELETE /:id/pocs/:pocId — Soft-delete a POC (sets isActive = false).
 *
 * Response 200:
 *   { "success": true }
 */
showroomStoresRouter.delete("/:id/pocs/:pocId", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const pocId = Number(c.req.param("pocId"));
  if (!Number.isFinite(storeId) || !Number.isFinite(pocId)) {
    return c.json({ success: false, error: "Invalid id" }, 400);
  }

  const [updated] = await db
    .update(showroomPocs)
    .set({ isActive: false, updatedAt: new Date() } as Partial<typeof showroomPocs.$inferInsert>)
    .where(and(eq(showroomPocs.id, pocId), eq(showroomPocs.showroomId, storeId)))
    .returning();

  if (!updated) return c.json({ success: false, error: "POC not found" }, 404);
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── NOTES (rich titled notes, migration 0057; tags, migration 0074) ─────────
// ═══════════════════════════════════════════════════════════════════════════════
//
// The `store_notes` table was extended in migration 0057 with `title`,
// `contentHtml`, `contentMarkdown`, and `isActive` (soft-delete). The old
// `note` plain-text column is still present for backward compatibility.
// Migration 0074 added `tagsJson` (nullable JSON string[]) — wire field name
// is `tags: string[]` ([] when null on read); accepted on create/update.
//
// NOTE: `POST /:id/notes` above in the original NOTES block only accepted a
// plain `note` string. The routes here supersede that with the full rich-text
// schema. The old route is left in place for backward compatibility; these new
// routes live in a separate clearly-sectioned block.

/** Max number of tags retained per note (extras beyond this are dropped). */
const NOTE_TAGS_MAX = 20;

/**
 * Parse a note's `tagsJson` column into a `tags: string[]` wire value.
 * Returns `[]` when the column is null or fails to parse as an array.
 */
function parseNoteTags(tagsJson: string | null | undefined): string[] {
  if (!tagsJson) return [];
  try {
    const parsed = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/** Trim, drop empties, dedupe (case-sensitive), and cap at NOTE_TAGS_MAX. */
function normalizeNoteTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= NOTE_TAGS_MAX) break;
  }
  return out;
}

/** Shape a raw `store_notes` row for the wire: adds `tags: string[]`. */
function serializeStoreNote(row: typeof storeNotes.$inferSelect) {
  const { tagsJson, ...rest } = row;
  return { ...rest, tags: parseNoteTags(tagsJson) };
}

const noteTagsBodySchema = z.object({
  tags: z.array(z.string().min(1)).max(NOTE_TAGS_MAX).optional(),
});

/**
 * GET /notes/tags — Distinct tags across ALL active store notes.
 *
 * Registered before `/:id/notes` and `/notes/:noteId` so the literal `tags`
 * segment is never captured as a `:noteId` param.
 *
 * Response 200:
 *   { "success": true, "tags": string[] }  // sorted, deduped
 */
showroomStoresRouter.get("/notes/tags", async (c) => {
  const db = drizzle(c.env.DB);

  const rows = await db
    .select({ tagsJson: storeNotes.tagsJson })
    .from(storeNotes)
    .where(and(eq(storeNotes.isActive, true), sql`${storeNotes.tagsJson} is not null`));

  const tagSet = new Set<string>();
  for (const row of rows) {
    for (const tag of parseNoteTags(row.tagsJson)) tagSet.add(tag);
  }

  return c.json({ success: true, tags: [...tagSet].sort() });
});

/**
 * GET /:id/notes — List active notes for a showroom, newest first.
 *
 * Response 200:
 *   { "notes": [ { id, storeId, title, note, contentHtml, contentMarkdown,
 *                  isActive, timestamp, tags }, ... ] }
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
    .where(and(eq(storeNotes.storeId, storeId), eq(storeNotes.isActive, true)))
    .orderBy(desc(storeNotes.timestamp));

  return c.json({ notes: notes.map(serializeStoreNote) });
});

/**
 * GET /:id/pending-quotes — Quotes/invoices/receipts extracted from email that
 * were resolved to THIS showroom and still await review (0042 P4).
 *
 * The email pipeline stamps `worker_email_invoices.showroom_store_id` when the
 * sender's domain/name matches a store, so a Pietra Fina quote surfaces right
 * in Pietra Fina's viewport as a pending item to confirm/map. Each row carries
 * its line items; each line carries the product it was matched to or created as
 * (0042 P5) — `productId` + `productName` (JOINed from products) + `matchStatus`.
 *
 * Response 200:
 *   { "quotes": [ { id, kind, vendorName, invoiceNumber, invoiceDate, dueDate,
 *                   subtotal, tax, total, currency, confidence, status, emailId,
 *                   createdAt, lineItems: [ { id, description, quantity,
 *                   unitPrice, lineTotal, matchStatus, productId, brandId,
 *                   productName } ] } ] }
 */
showroomStoresRouter.get("/:id/pending-quotes", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isFinite(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  // Cap at 50: a store realistically carries a handful of open drafts, and the
  // cap bounds the line-items `inArray` below to <=50 bound params — safely
  // under D1's 100-param limit without needing to chunk.
  const invoices = await db
    .select()
    .from(workerEmailInvoices)
    .where(
      and(
        eq(workerEmailInvoices.showroomStoreId, storeId),
        eq(workerEmailInvoices.status, "draft"),
      ),
    )
    .orderBy(desc(workerEmailInvoices.createdAt))
    .limit(50);

  if (invoices.length === 0) return c.json({ quotes: [] });

  // One IN() over the (<=50) invoice ids — stays under D1's 100 bound-param cap.
  const invoiceIds = invoices.map((inv) => inv.id);
  const lines = await db
    .select({
      id: workerEmailInvoiceLineItems.id,
      invoiceId: workerEmailInvoiceLineItems.invoiceId,
      description: workerEmailInvoiceLineItems.description,
      quantity: workerEmailInvoiceLineItems.quantity,
      unitPrice: workerEmailInvoiceLineItems.unitPrice,
      lineTotal: workerEmailInvoiceLineItems.lineTotal,
      matchStatus: workerEmailInvoiceLineItems.matchStatus,
      productId: workerEmailInvoiceLineItems.productId,
      // Product display name + brand JOINed — never denormalized onto the line.
      productName: showroomStoreProducts.itemName,
      brandId: showroomStoreProducts.brandId,
    })
    .from(workerEmailInvoiceLineItems)
    .leftJoin(
      showroomStoreProducts,
      eq(showroomStoreProducts.id, workerEmailInvoiceLineItems.productId),
    )
    .where(inArray(workerEmailInvoiceLineItems.invoiceId, invoiceIds))
    .orderBy(asc(workerEmailInvoiceLineItems.id));

  const linesByInvoice = new Map<number, typeof lines>();
  for (const li of lines) {
    const arr = linesByInvoice.get(li.invoiceId) ?? [];
    arr.push(li);
    linesByInvoice.set(li.invoiceId, arr);
  }

  const quotes = invoices.map((inv) => ({
    id: inv.id,
    kind: inv.kind,
    vendorName: inv.vendorName,
    invoiceNumber: inv.invoiceNumber,
    invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate,
    subtotal: inv.subtotal,
    tax: inv.tax,
    total: inv.total,
    currency: inv.currency,
    confidence: inv.confidence,
    status: inv.status,
    emailId: inv.emailId,
    createdAt: inv.createdAt instanceof Date ? inv.createdAt.getTime() : inv.createdAt,
    lineItems: (linesByInvoice.get(inv.id) ?? []).map((li) => ({
      id: li.id,
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
      lineTotal: li.lineTotal,
      matchStatus: li.matchStatus,
      productId: li.productId,
      brandId: li.brandId,
      productName: li.productName,
    })),
  }));

  return c.json({ quotes });
});

/**
 * POST /:id/notes — Create a new titled rich note for a showroom.
 *
 * Request body:
 *   {
 *     "title": "Post-visit impressions",
 *     "contentHtml": "<p>Waterworks display was incredible.</p>",
 *     "contentMarkdown": "Waterworks display was incredible.",
 *     "note": "plain text fallback (optional)",
 *     "tags": ["favorite", "follow-up"]
 *   }
 *
 * Response 201:
 *   { "note": { id, storeId, title, note, contentHtml, contentMarkdown, isActive, timestamp, tags } }
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

  const createNoteSchema = z
    .object({
      title: z.string().optional().nullable(),
      contentHtml: z.string().optional().nullable(),
      contentMarkdown: z.string().optional().nullable(),
      note: z.string().optional().nullable(),
    })
    .merge(noteTagsBodySchema);

  const parsed = createNoteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  const normalizedTags = normalizeNoteTags(parsed.data.tags);

  const [inserted] = await db
    .insert(storeNotes)
    .values({
      storeId,
      title: parsed.data.title ?? null,
      contentHtml: parsed.data.contentHtml ?? null,
      contentMarkdown: parsed.data.contentMarkdown ?? null,
      note: parsed.data.note ?? null,
      isActive: true,
      tagsJson: normalizedTags.length > 0 ? JSON.stringify(normalizedTags) : null,
    } as typeof storeNotes.$inferInsert)
    .returning();

  return c.json({ note: serializeStoreNote(inserted) }, 201);
});

/**
 * PUT /notes/:noteId — Update the title and/or rich content of a note.
 *
 * Request body (all optional; only provided fields are updated):
 *   {
 *     "title": "Updated title",
 *     "contentHtml": "<p>New content.</p>",
 *     "contentMarkdown": "New content.",
 *     "tags": ["favorite"]
 *   }
 *
 * Response 200:
 *   { "note": { ...updatedRow, tags } }
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

  const updateNoteSchema = z
    .object({
      title: z.string().optional().nullable(),
      contentHtml: z.string().optional().nullable(),
      contentMarkdown: z.string().optional().nullable(),
      note: z.string().optional().nullable(),
    })
    .merge(noteTagsBodySchema);

  const parsed = updateNoteSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  const patch: Partial<typeof storeNotes.$inferInsert> = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.contentHtml !== undefined) patch.contentHtml = parsed.data.contentHtml;
  if (parsed.data.contentMarkdown !== undefined)
    patch.contentMarkdown = parsed.data.contentMarkdown;
  if (parsed.data.note !== undefined) patch.note = parsed.data.note;
  if (parsed.data.tags !== undefined) {
    const normalizedTags = normalizeNoteTags(parsed.data.tags);
    patch.tagsJson = normalizedTags.length > 0 ? JSON.stringify(normalizedTags) : null;
  }

  // Guard against an empty patch: Drizzle `.set({})` emits an empty UPDATE,
  // which is a SQL syntax error in SQLite/D1. With nothing to change, return
  // the current row (or 404 if it doesn't exist) instead of issuing the query.
  if (Object.keys(patch).length === 0) {
    const [existing] = await db.select().from(storeNotes).where(eq(storeNotes.id, noteId)).limit(1);
    if (!existing) {
      return c.json({ success: false, error: "Note not found" }, 404);
    }
    return c.json({ note: serializeStoreNote(existing) });
  }

  const [updated] = await db
    .update(storeNotes)
    .set(patch)
    .where(eq(storeNotes.id, noteId))
    .returning();

  if (!updated) {
    return c.json({ success: false, error: "Note not found" }, 404);
  }

  return c.json({ note: serializeStoreNote(updated) });
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

  // Only homeowner-uploaded visit photos belong in the "Your visit photos" card.
  // The sourcing sweep writes storefront/showroom/logo/map/unknown rows into the
  // same table, so an unfiltered read leaks scraped website imagery here.
  const photos = await db
    .select()
    .from(showroomImages)
    .where(
      and(
        eq(showroomImages.storeId, storeId),
        eq(showroomImages.imageKind, "visit"),
      ),
    )
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
  let photoMeta: PhotoMetadata = {};
  // MIME of the STORED image: HEIC/HEIF get transcoded to JPEG on upload.
  let storedMimeType: string | null = null;
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
    storedMimeType = /heic|heif/i.test(mime) ? "image/jpeg" : mime;
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });

    // EXIF/dimensions from the ORIGINAL bytes (before any HEIC→JPEG transcode).
    photoMeta = await processor.extractPhotoMetadata(blob);

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
    width: photoMeta.width ?? null,
    height: photoMeta.height ?? null,
    mimeType: storedMimeType,
    metadataJson: Object.keys(photoMeta).length ? JSON.stringify(photoMeta) : null,
  };

  const [inserted] = await db
    .insert(showroomImages)
    .values(imageInsertValues)
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

  // Markdown is the source of truth: derive the HTML cache from it. When only a
  // legacy HTML value is supplied, sanitize it rather than storing verbatim.
  const noteMarkdown = parsed.data.noteMarkdown?.trim() ? parsed.data.noteMarkdown : null;
  const noteHtml = noteMarkdown
    ? renderNoteHtml(noteMarkdown)
    : parsed.data.noteHtml?.trim()
      ? sanitizeNoteHtml(parsed.data.noteHtml)
      : null;

  const [updated] = await db
    .update(showroomImages)
    .set({
      noteHtml,
      noteMarkdown,
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
 * DELETE /:id/photos-gallery/:photoId — Delete a Google Places gallery photo.
 *
 * Removes the `showroom_photos_mapping` row and deletes the binary from
 * Cloudflare Images. If the deleted photo was the store's `heroImageCfImagesUrl`,
 * promotes the next gallery photo (by sort order) to hero, or nulls it out.
 *
 * Response 200:
 *   { "success": true }
 */
showroomStoresRouter.delete("/:id/photos-gallery/:photoId", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const photoId = Number(c.req.param("photoId"));
  if (!Number.isFinite(storeId) || !Number.isFinite(photoId)) {
    return c.json({ success: false, error: "Invalid id" }, 400);
  }

  // Fetch the row to get the CF Images URL before deleting.
  const [photo] = await db
    .select()
    .from(showroomPhotosMapping)
    .where(
      and(eq(showroomPhotosMapping.id, photoId), eq(showroomPhotosMapping.showroomId, storeId)),
    )
    .limit(1);
  if (!photo) return c.json({ success: false, error: "Photo not found" }, 404);

  // Delete from D1.
  await db.delete(showroomPhotosMapping).where(eq(showroomPhotosMapping.id, photoId));

  // Best-effort delete from Cloudflare Images.
  try {
    const { accountId, apiTokens } = await resolveCloudflareImagesCredentials(c.env);
    if (accountId && apiTokens.length > 0) {
      const [primaryToken, ...fallbackApiTokens] = apiTokens;
      const processor = new ImageProcessorService(c.env, accountId, primaryToken, {
        fallbackApiTokens,
      });
      // Extract the custom ID from the delivery URL (e.g. "showroom-photo-36-0").
      const segments = new URL(photo.cfImagesPhotoUrl).pathname.split("/").filter(Boolean);
      const cfImageId = segments.length >= 2 ? segments[1] : null;
      if (cfImageId) await processor.deleteFromCloudflareImages(cfImageId);
    }
  } catch (err) {
    console.error("[showroom-stores] gallery photo CF Images delete error:", err);
  }

  // If this was the hero image, promote the next one or null out.
  const [store] = await db
    .select({ heroImageCfImagesUrl: showroomStores.heroImageCfImagesUrl })
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);

  if (store?.heroImageCfImagesUrl === photo.cfImagesPhotoUrl) {
    const [nextPhoto] = await db
      .select({ cfImagesPhotoUrl: showroomPhotosMapping.cfImagesPhotoUrl })
      .from(showroomPhotosMapping)
      .where(eq(showroomPhotosMapping.showroomId, storeId))
      .orderBy(asc(showroomPhotosMapping.sortOrder))
      .limit(1);

    await db
      .update(showroomStores)
      .set({
        heroImageCfImagesUrl: nextPhoto?.cfImagesPhotoUrl ?? null,
        updatedAt: new Date(),
      })
      .where(eq(showroomStores.id, storeId));
  }

  return c.json({ success: true });
});

/**
 * DELETE /:id/photos/:imageId — Delete a visit photo (showroom_images row).
 *
 * Response 200:
 *   { "success": true }
 */
showroomStoresRouter.delete("/:id/photos/:imageId", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const imageId = Number(c.req.param("imageId"));
  if (!Number.isFinite(storeId) || !Number.isFinite(imageId)) {
    return c.json({ success: false, error: "Invalid id" }, 400);
  }

  const [image] = await db
    .select()
    .from(showroomImages)
    .where(and(eq(showroomImages.id, imageId), eq(showroomImages.storeId, storeId)))
    .limit(1);
  if (!image) return c.json({ success: false, error: "Image not found" }, 404);

  await db.delete(showroomImages).where(eq(showroomImages.id, imageId));

  // Best-effort delete from Cloudflare Images.
  if (image.cfImageId) {
    try {
      const { accountId, apiTokens } = await resolveCloudflareImagesCredentials(c.env);
      if (accountId && apiTokens.length > 0) {
        const [primaryToken, ...fallbackApiTokens] = apiTokens;
        const processor = new ImageProcessorService(c.env, accountId, primaryToken, {
          fallbackApiTokens,
        });
        await processor.deleteFromCloudflareImages(image.cfImageId);
      }
    } catch (err) {
      console.error("[showroom-stores] visit photo CF Images delete error:", err);
    }
  }

  return c.json({ success: true });
});

/**
 * PATCH /:id/photos/:imageId — Edit an image's altText and/or re-tag its kind.
 *
 * Works for ANY image kind on the store (visit or a sweep-discovered
 * storefront/showroom/logo/map/unknown row). Ownership is enforced: the image
 * must belong to `:id`, so a caller can't touch another store's image (IDOR).
 *
 * Request body (both optional):
 *   { "altText": "Entry display", "imageKind": "storefront" }
 *
 * Response 200: { "photo": { ...updatedRow } }
 */
showroomStoresRouter.patch("/:id/photos/:imageId", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const imageId = Number(c.req.param("imageId"));
  if (!Number.isFinite(storeId) || !Number.isFinite(imageId)) {
    return c.json({ success: false, error: "Invalid id" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const patchSchema = z.object({
    altText: z.string().optional().nullable(),
    imageKind: z.enum(["visit", "storefront", "showroom", "logo", "map", "unknown"]).optional(),
  });
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  // Ownership guard — the image must belong to this store.
  const [image] = await db
    .select({ id: showroomImages.id })
    .from(showroomImages)
    .where(and(eq(showroomImages.id, imageId), eq(showroomImages.storeId, storeId)))
    .limit(1);
  if (!image) return c.json({ success: false, error: "Image not found" }, 404);

  const patch: Partial<typeof showroomImages.$inferInsert> = { updatedAt: new Date() };
  if ("altText" in parsed.data) patch.altText = parsed.data.altText ?? null;
  if (parsed.data.imageKind !== undefined) patch.imageKind = parsed.data.imageKind;

  const [updated] = await db
    .update(showroomImages)
    .set(patch)
    .where(eq(showroomImages.id, imageId))
    .returning();

  return c.json({ photo: updated });
});

/**
 * POST /:id/photos/bulk-delete — Delete several images at once (multi-select).
 *
 * Every id must belong to `:id` — the delete is scoped by storeId so a stray or
 * hostile id in the list can't remove another store's image (IDOR). Cloudflare
 * Images cleanup is best-effort per row.
 *
 * Request body: { "imageIds": [12, 15, 19] }
 * Response 200: { "success": true, "deleted": 3 }
 */
showroomStoresRouter.post("/:id/photos/bulk-delete", async (c) => {
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

  const parsed = z.object({ imageIds: z.array(z.number().int().positive()).min(1) }).safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }
  const ids = [...new Set(parsed.data.imageIds)];

  // Select only the rows that actually belong to this store (ownership filter).
  // Chunk the IN list at 20 to stay under D1's 100 bound-parameter cap.
  const owned: { id: number; cfImageId: string | null }[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const part = ids.slice(i, i + 20);
    const rows = await db
      .select({ id: showroomImages.id, cfImageId: showroomImages.cfImageId })
      .from(showroomImages)
      .where(and(eq(showroomImages.storeId, storeId), inArray(showroomImages.id, part)));
    owned.push(...rows);
  }
  if (owned.length === 0) return c.json({ success: true, deleted: 0 });

  const ownedIds = owned.map((r) => r.id);
  for (let i = 0; i < ownedIds.length; i += 20) {
    const part = ownedIds.slice(i, i + 20);
    await db.delete(showroomImages).where(inArray(showroomImages.id, part));
  }

  // Best-effort Cloudflare Images cleanup for the deleted rows.
  const cfIds = owned.map((r) => r.cfImageId).filter((v): v is string => Boolean(v));
  if (cfIds.length > 0) {
    try {
      const { accountId, apiTokens } = await resolveCloudflareImagesCredentials(c.env);
      if (accountId && apiTokens.length > 0) {
        const [primaryToken, ...fallbackApiTokens] = apiTokens;
        const processor = new ImageProcessorService(c.env, accountId, primaryToken, { fallbackApiTokens });
        for (const cfId of cfIds) await processor.deleteFromCloudflareImages(cfId);
      }
    } catch (err) {
      console.error("[showroom-stores] bulk photo CF Images delete error:", err);
    }
  }

  return c.json({ success: true, deleted: ownedIds.length });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ─── IMAGE GROUPS (photo folders / stacks) — 0040 P3 ─────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

/** Verify a set of image ids belong to a store; returns the owned subset. */
async function ownedImageIds(
  db: ReturnType<typeof drizzle>,
  storeId: number,
  ids: number[],
): Promise<number[]> {
  const unique = [...new Set(ids)];
  const owned: number[] = [];
  for (let i = 0; i < unique.length; i += 20) {
    const part = unique.slice(i, i + 20);
    const rows = await db
      .select({ id: showroomImages.id })
      .from(showroomImages)
      .where(and(eq(showroomImages.storeId, storeId), inArray(showroomImages.id, part)));
    owned.push(...rows.map((r) => r.id));
  }
  return owned;
}

/**
 * GET /:id/image-groups — list active folders for a store, each with its member
 * count and a cover delivery URL (the group's coverImageId, else its newest
 * member). Loose photos are the `/photos` rows with a null group_id.
 */
showroomStoresRouter.get("/:id/image-groups", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  if (!Number.isFinite(storeId)) {
    return c.json({ success: false, error: "Invalid store id" }, 400);
  }

  const groups = await db
    .select()
    .from(showroomImageGroups)
    .where(and(eq(showroomImageGroups.storeId, storeId), eq(showroomImageGroups.isActive, true)))
    .orderBy(asc(showroomImageGroups.sortOrder), desc(showroomImageGroups.createdAt));

  // Members for this store's grouped photos (one query, then bucket in JS).
  const members = await db
    .select({
      id: showroomImages.id,
      groupId: showroomImages.groupId,
      deliveryUrl: showroomImages.deliveryUrl,
    })
    .from(showroomImages)
    .where(eq(showroomImages.storeId, storeId));

  const byGroup = new Map<number, { id: number; deliveryUrl: string }[]>();
  for (const m of members) {
    if (m.groupId == null) continue;
    const list = byGroup.get(m.groupId) ?? [];
    list.push({ id: m.id, deliveryUrl: m.deliveryUrl });
    byGroup.set(m.groupId, list);
  }

  const result = groups.map((g) => {
    const mem = byGroup.get(g.id) ?? [];
    const cover =
      (g.coverImageId != null ? mem.find((m) => m.id === g.coverImageId)?.deliveryUrl : null) ??
      mem[0]?.deliveryUrl ??
      null;
    return { ...g, memberCount: mem.length, coverDeliveryUrl: cover };
  });

  return c.json({ groups: result });
});

/**
 * POST /:id/image-groups — create a folder and (optionally) move photos into it.
 *
 * Body: { name, descriptionMarkdown?, priceText?, priceCents?, coverImageId?,
 *         imageIds?: number[] }. descriptionHtml is derived server-side; imageIds
 * are ownership-filtered before their group_id is set.
 */
showroomStoresRouter.post("/:id/image-groups", async (c) => {
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

  const schema = z.object({
    name: z.string().trim().min(1),
    descriptionMarkdown: z.string().optional().nullable(),
    priceText: z.string().optional().nullable(),
    priceCents: z.number().int().optional().nullable(),
    coverImageId: z.number().int().positive().optional().nullable(),
    imageIds: z.array(z.number().int().positive()).optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  const [store] = await db
    .select({ id: showroomStores.id })
    .from(showroomStores)
    .where(eq(showroomStores.id, storeId))
    .limit(1);
  if (!store) return c.json({ success: false, error: "Showroom not found" }, 404);

  const md = parsed.data.descriptionMarkdown?.trim() ? parsed.data.descriptionMarkdown : null;
  const [group] = await db
    .insert(showroomImageGroups)
    .values({
      storeId,
      name: parsed.data.name.trim(),
      descriptionMarkdown: md,
      descriptionHtml: md ? renderNoteHtml(md) : null,
      priceText: parsed.data.priceText?.trim() ? parsed.data.priceText : null,
      priceCents: parsed.data.priceCents ?? null,
      coverImageId: parsed.data.coverImageId ?? null,
    })
    .returning();

  // Move the given photos into the new group (ownership-filtered, chunked).
  if (parsed.data.imageIds?.length && group) {
    const owned = await ownedImageIds(db, storeId, parsed.data.imageIds);
    for (let i = 0; i < owned.length; i += 20) {
      const part = owned.slice(i, i + 20);
      await db
        .update(showroomImages)
        .set({ groupId: group.id, updatedAt: new Date() } as Partial<typeof showroomImages.$inferInsert>)
        .where(inArray(showroomImages.id, part));
    }
  }

  return c.json({ group }, 201);
});

/**
 * PATCH /:id/image-groups/:groupId — rename / re-describe / re-price / re-cover /
 * reorder a folder. descriptionHtml is re-derived when descriptionMarkdown is set.
 */
showroomStoresRouter.patch("/:id/image-groups/:groupId", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const groupId = Number(c.req.param("groupId"));
  if (!Number.isFinite(storeId) || !Number.isFinite(groupId)) {
    return c.json({ success: false, error: "Invalid id" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const schema = z.object({
    name: z.string().trim().min(1).optional(),
    descriptionMarkdown: z.string().optional().nullable(),
    priceText: z.string().optional().nullable(),
    priceCents: z.number().int().optional().nullable(),
    coverImageId: z.number().int().positive().optional().nullable(),
    sortOrder: z.number().int().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  // Ownership: the group must belong to this store.
  const [group] = await db
    .select({ id: showroomImageGroups.id })
    .from(showroomImageGroups)
    .where(and(eq(showroomImageGroups.id, groupId), eq(showroomImageGroups.storeId, storeId)))
    .limit(1);
  if (!group) return c.json({ success: false, error: "Group not found" }, 404);

  const patch: Partial<typeof showroomImageGroups.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.name !== undefined) patch.name = parsed.data.name.trim();
  if ("descriptionMarkdown" in parsed.data) {
    const md = parsed.data.descriptionMarkdown?.trim() ? parsed.data.descriptionMarkdown : null;
    patch.descriptionMarkdown = md;
    patch.descriptionHtml = md ? renderNoteHtml(md) : null;
  }
  if ("priceText" in parsed.data) patch.priceText = parsed.data.priceText?.trim() ? parsed.data.priceText : null;
  if ("priceCents" in parsed.data) patch.priceCents = parsed.data.priceCents ?? null;
  if ("coverImageId" in parsed.data) patch.coverImageId = parsed.data.coverImageId ?? null;
  if (parsed.data.sortOrder !== undefined) patch.sortOrder = parsed.data.sortOrder;

  const [updated] = await db
    .update(showroomImageGroups)
    .set(patch)
    .where(eq(showroomImageGroups.id, groupId))
    .returning();

  return c.json({ group: updated });
});

/**
 * POST /:id/image-groups/:groupId/members — add/remove photos.
 * Body: { add?: number[], remove?: number[] }. `add` sets group_id (ownership
 * filtered); `remove` clears group_id back to loose (only for rows in THIS group).
 */
showroomStoresRouter.post("/:id/image-groups/:groupId/members", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const groupId = Number(c.req.param("groupId"));
  if (!Number.isFinite(storeId) || !Number.isFinite(groupId)) {
    return c.json({ success: false, error: "Invalid id" }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const parsed = z
    .object({
      add: z.array(z.number().int().positive()).optional(),
      remove: z.array(z.number().int().positive()).optional(),
    })
    .safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: parsed.error.message }, 400);
  }

  const [group] = await db
    .select({ id: showroomImageGroups.id })
    .from(showroomImageGroups)
    .where(and(eq(showroomImageGroups.id, groupId), eq(showroomImageGroups.storeId, storeId)))
    .limit(1);
  if (!group) return c.json({ success: false, error: "Group not found" }, 404);

  if (parsed.data.add?.length) {
    const owned = await ownedImageIds(db, storeId, parsed.data.add);
    for (let i = 0; i < owned.length; i += 20) {
      const part = owned.slice(i, i + 20);
      await db
        .update(showroomImages)
        .set({ groupId, updatedAt: new Date() } as Partial<typeof showroomImages.$inferInsert>)
        .where(inArray(showroomImages.id, part));
    }
  }
  if (parsed.data.remove?.length) {
    const owned = await ownedImageIds(db, storeId, parsed.data.remove);
    for (let i = 0; i < owned.length; i += 20) {
      const part = owned.slice(i, i + 20);
      await db
        .update(showroomImages)
        .set({ groupId: null, updatedAt: new Date() } as Partial<typeof showroomImages.$inferInsert>)
        .where(and(eq(showroomImages.groupId, groupId), inArray(showroomImages.id, part)));
    }
  }

  return c.json({ success: true });
});

/**
 * DELETE /:id/image-groups/:groupId — soft-delete a folder and loosen its photos
 * (their group_id → null). The photos themselves are never deleted here.
 */
showroomStoresRouter.delete("/:id/image-groups/:groupId", async (c) => {
  const db = drizzle(c.env.DB);
  const storeId = Number(c.req.param("id"));
  const groupId = Number(c.req.param("groupId"));
  if (!Number.isFinite(storeId) || !Number.isFinite(groupId)) {
    return c.json({ success: false, error: "Invalid id" }, 400);
  }

  const [group] = await db
    .select({ id: showroomImageGroups.id })
    .from(showroomImageGroups)
    .where(and(eq(showroomImageGroups.id, groupId), eq(showroomImageGroups.storeId, storeId)))
    .limit(1);
  if (!group) return c.json({ success: false, error: "Group not found" }, 404);

  // Loosen members first so no row is left pointing at an inactive group, then
  // soft-delete the group. (Two statements — D1 has no transactions.)
  await db
    .update(showroomImages)
    .set({ groupId: null, updatedAt: new Date() } as Partial<typeof showroomImages.$inferInsert>)
    .where(eq(showroomImages.groupId, groupId));
  await db
    .update(showroomImageGroups)
    .set({ isActive: false, updatedAt: new Date() } as Partial<typeof showroomImageGroups.$inferInsert>)
    .where(eq(showroomImageGroups.id, groupId));

  return c.json({ success: true });
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
