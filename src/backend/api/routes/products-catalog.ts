/**
 * @fileoverview Products Catalog API (0020 subsystem B — products-page revamp)
 *
 * Two read-only endpoints backing the new global products page:
 *   GET /catalog — filterable product grid + facet counts.
 *   GET /browse  — browse-by-room / browse-by-category / "needs a product" toggle data.
 *
 * Mounts at /api/products (wired in api/index.ts). Mirrors the style of
 * showroom-catalog.ts / showroom-products.ts: plain Hono (not OpenAPIHono +
 * createRoute — this repo's routes don't register OpenAPI schemas), drizzle
 * queries fetched in bulk then folded in JS to avoid N+1s.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, gte, inArray, isNull, like, lte, notInArray, or, isNotNull } from "drizzle-orm";
import { z } from "zod";

import {
  showroomStoreProducts,
  productPriceObservations,
  productShowroomPhotos,
  productMaterialMappings,
  showroomStoreCategory,
  productImages,
} from "@backend/db/schema/showroom/index";
import { brands } from "@backend/db/schema/brands/index";
import { materialScheduleItems } from "@backend/db/schema/materials/schedule_item";
import { wishlistItems } from "@backend/db/schema/wishlist/wishlist_items";
import { rooms } from "@backend/db/schema/home/rooms";

export const productsCatalogRouter = new Hono<{ Bindings: Env }>();

// Zod v4: z.coerce.number() coerces query-string ints; .min(1) not .nonempty().
const catalogQuerySchema = z.object({
  roomId: z.coerce.number().int().optional(),
  categoryId: z.coerce.number().int().optional(),
  productType: z.string().min(1).optional(),
  brandId: z.string().min(1).optional(), // csv of ids, split below
  purchased: z.enum(["yes", "no"]).optional(),
  wishlisted: z.enum(["yes", "no"]).optional(),
  priceMin: z.coerce.number().int().optional(),
  priceMax: z.coerce.number().int().optional(),
  q: z.string().min(1).optional(),
  needsProduct: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

// ─── GET /catalog ───────────────────────────────────────────────────────────

/**
 * GET /catalog — filterable global product grid with facet counts.
 *
 * `roomId` / `categoryId` are accepted but currently no-op filters (see
 * comment below) — there is no product_areas/room join cheap enough to add
 * without an extra migration, and this is a read-only pass (no migrations).
 * `needsProduct=1` switches the endpoint into "materials needing a product"
 * mode is handled by GET /browse instead (per spec); this query param is
 * accepted here for forward-compat but not yet wired to a distinct query.
 */
productsCatalogRouter.get("/catalog", async (c) => {
  const parsed = catalogQuerySchema.safeParse(c.req.query());
  if (!parsed.success) {
    return c.json({ error: { code: "bad_request", message: "Invalid query params", details: parsed.error.flatten() } }, 400);
  }
  const q = parsed.data;
  const db = drizzle(c.env.DB);

  // ponytail: roomId/categoryId have no cheap join today (no product_areas
  // FK on showroom_store_products, no showroom_store_category link to
  // products directly) — accepted-but-ignored rather than forcing a join
  // that doesn't exist. Add a real join if/when a product<->room or
  // product<->category mapping table lands.
  void q.roomId;
  void q.categoryId;

  const brandIds = q.brandId
    ? q.brandId
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n))
    : [];

  const conditions = [];
  if (brandIds.length > 0) conditions.push(inArray(showroomStoreProducts.brandId, brandIds));
  if (q.productType) conditions.push(eq(showroomStoreProducts.productType, q.productType));
  if (q.q) {
    conditions.push(
      or(
        like(showroomStoreProducts.itemName, `%${q.q}%`),
        like(showroomStoreProducts.sku, `%${q.q}%`),
      ),
    );
  }

  let baseQuery = db
    .select({
      id: showroomStoreProducts.id,
      itemName: showroomStoreProducts.itemName,
      brandId: showroomStoreProducts.brandId,
      brandName: brands.name,
      productType: showroomStoreProducts.productType,
      msrp: showroomStoreProducts.msrp,
      msrpCents: showroomStoreProducts.msrpCents,
      colors: showroomStoreProducts.colors,
    })
    .from(showroomStoreProducts)
    .leftJoin(brands, eq(showroomStoreProducts.brandId, brands.id))
    .orderBy(desc(showroomStoreProducts.id))
    .$dynamic();

  if (conditions.length > 0) baseQuery = baseQuery.where(and(...conditions));
  // Bound the fetch (and the downstream per-id batch queries) — the catalog can
  // grow unbounded otherwise. Default page 200, hard cap 500.
  baseQuery = baseQuery.limit(q.limit ?? 200).offset(q.offset ?? 0);

  const rawProducts = await baseQuery;

  if (rawProducts.length === 0) {
    return c.json({
      products: [],
      facets: { brands: [], productTypes: [], priceRange: { min: null, max: null }, purchasedCount: 0, wishlistedCount: 0, total: 0 },
    });
  }

  const ids = rawProducts.map((p) => p.id);

  // D1 caps a query at 100 bound parameters, so chunk `ids` (<100) and run each
  // chunk in parallel. Also scope purchased/wishlisted lookups to `ids` — an
  // unfiltered scan would fetch every material/wishlist row in the DB.
  const idChunks: number[][] = [];
  for (let i = 0; i < ids.length; i += 90) idChunks.push(ids.slice(i, i + 90));
  const perChunk = <T>(fn: (chunk: number[]) => Promise<T[]>) =>
    Promise.all(idChunks.map(fn)).then((res) => res.flat());

  const [purchasedRows, wishlistedRows, priceRows, imageRows, photoRows] = await Promise.all([
    perChunk((chunk) =>
      db
        .select({ productId: materialScheduleItems.productId })
        .from(materialScheduleItems)
        .where(
          and(
            eq(materialScheduleItems.isPurchased, true),
            isNotNull(materialScheduleItems.productId),
            inArray(materialScheduleItems.productId, chunk),
          ),
        ),
    ),
    perChunk((chunk) =>
      db
        .select({ showroomStoreProductId: wishlistItems.showroomStoreProductId })
        .from(wishlistItems)
        .where(
          and(
            isNotNull(wishlistItems.showroomStoreProductId),
            notInArray(wishlistItems.status, ["dismissed"]),
            inArray(wishlistItems.showroomStoreProductId, chunk),
          ),
        ),
    ),
    perChunk((chunk) =>
      db
        .select({ productId: productPriceObservations.productId, priceCents: productPriceObservations.priceCents })
        .from(productPriceObservations)
        .where(inArray(productPriceObservations.productId, chunk)),
    ),
    perChunk((chunk) =>
      db
        .select({ storeProductId: productImages.storeProductId, deliveryUrl: productImages.deliveryUrl })
        .from(productImages)
        .where(inArray(productImages.storeProductId, chunk))
        .orderBy(desc(productImages.createdAt)),
    ),
    perChunk((chunk) =>
      db
        .select({ productId: productShowroomPhotos.productId, imageUrl: productShowroomPhotos.imageUrl })
        .from(productShowroomPhotos)
        .where(inArray(productShowroomPhotos.productId, chunk))
        .orderBy(desc(productShowroomPhotos.createdAt)),
    ),
  ]);
  // Note: chunk boundaries mean the image/photo "newest wins" ordering is only
  // guaranteed within a chunk; fine here since each product's rows stay together
  // (filtered by that product's id) — cross-chunk mixing can't reorder a product.

  const purchasedSet = new Set(purchasedRows.map((r) => r.productId).filter((v): v is number => v != null));
  const wishlistedSet = new Set(wishlistedRows.map((r) => r.showroomStoreProductId).filter((v): v is number => v != null));

  const minPriceMap = new Map<number, number>();
  for (const r of priceRows) {
    if (r.priceCents == null) continue;
    const cur = minPriceMap.get(r.productId);
    if (cur === undefined || r.priceCents < cur) minPriceMap.set(r.productId, r.priceCents);
  }

  // productImages rows are DESC by createdAt — first hit per product wins.
  const imageMap = new Map<number, string>();
  for (const r of imageRows) {
    if (!imageMap.has(r.storeProductId) && r.deliveryUrl) imageMap.set(r.storeProductId, r.deliveryUrl);
  }
  // Fall back to productShowroomPhotos (also DESC) for products with no productImages row.
  for (const r of photoRows) {
    if (!imageMap.has(r.productId) && r.imageUrl) imageMap.set(r.productId, r.imageUrl);
  }

  let products = rawProducts.map((p) => ({
    id: p.id,
    itemName: p.itemName,
    brandId: p.brandId ?? null,
    brandName: p.brandName ?? null,
    productType: p.productType ?? null,
    imageUrl: imageMap.get(p.id) ?? null,
    msrp: p.msrp ?? null,
    msrpCents: p.msrpCents ?? null,
    minPriceCents: minPriceMap.get(p.id) ?? null,
    colors: p.colors ?? null,
    userRating: null as number | null, // no product-level rating source wired here
    isPurchased: purchasedSet.has(p.id),
    isWishlisted: wishlistedSet.has(p.id),
  }));

  // purchased/wishlisted/price filters apply to the computed fields, so they
  // run in JS after the DB fetch rather than as SQL WHERE clauses.
  if (q.purchased === "yes") products = products.filter((p) => p.isPurchased);
  if (q.purchased === "no") products = products.filter((p) => !p.isPurchased);
  if (q.wishlisted === "yes") products = products.filter((p) => p.isWishlisted);
  if (q.wishlisted === "no") products = products.filter((p) => !p.isWishlisted);
  if (q.priceMin != null) products = products.filter((p) => p.minPriceCents != null && p.minPriceCents >= q.priceMin!);
  if (q.priceMax != null) products = products.filter((p) => p.minPriceCents != null && p.minPriceCents <= q.priceMax!);

  // ponytail: facets are computed over the current (already-filtered) result
  // set, not the unfiltered universe — simpler, one pass, no parallel
  // "everything except this facet" queries. Upgrade to per-facet independent
  // counts if the UI needs "5 more brands available" style counts.
  const brandCounts = new Map<number, { label: string; count: number }>();
  const typeCounts = new Map<string, number>();
  let minPrice: number | null = null;
  let maxPrice: number | null = null;
  let purchasedCount = 0;
  let wishlistedCount = 0;

  for (const p of products) {
    if (p.brandId != null) {
      const entry = brandCounts.get(p.brandId) ?? { label: p.brandName ?? `#${p.brandId}`, count: 0 };
      entry.count += 1;
      brandCounts.set(p.brandId, entry);
    }
    if (p.productType) typeCounts.set(p.productType, (typeCounts.get(p.productType) ?? 0) + 1);
    if (p.minPriceCents != null) {
      if (minPrice === null || p.minPriceCents < minPrice) minPrice = p.minPriceCents;
      if (maxPrice === null || p.minPriceCents > maxPrice) maxPrice = p.minPriceCents;
    }
    if (p.isPurchased) purchasedCount += 1;
    if (p.isWishlisted) wishlistedCount += 1;
  }

  return c.json({
    products,
    facets: {
      brands: [...brandCounts.entries()].map(([value, { label, count }]) => ({ value, label, count })),
      productTypes: [...typeCounts.entries()].map(([value, count]) => ({ value, label: value, count })),
      priceRange: { min: minPrice, max: maxPrice },
      purchasedCount,
      wishlistedCount,
      total: products.length,
    },
  });
});

// ─── GET /browse ────────────────────────────────────────────────────────────

/**
 * GET /browse — data for the "browse by" toggle (room / category / needs-a-product).
 */
productsCatalogRouter.get("/browse", async (c) => {
  const db = drizzle(c.env.DB);

  const [activeRooms, distinctTypes, categoryRows, materialsNeedingProductRows] = await Promise.all([
    db
      .select({ id: rooms.id, roomName: rooms.roomName })
      .from(rooms)
      .where(eq(rooms.isActive, true)),
    db
      .selectDistinct({ productType: showroomStoreProducts.productType })
      .from(showroomStoreProducts)
      .where(isNotNull(showroomStoreProducts.productType)),
    db
      .select({ id: showroomStoreCategory.id, name: showroomStoreCategory.name })
      .from(showroomStoreCategory)
      .where(eq(showroomStoreCategory.isActive, true)),
    // "Needs a product" = unpurchased material with no product_material_mappings
    // row. A left join + IS NULL does this in one query (no full-table fetch).
    db
      .select({ id: materialScheduleItems.id, title: materialScheduleItems.title, roomName: rooms.roomName })
      .from(materialScheduleItems)
      .leftJoin(productMaterialMappings, eq(materialScheduleItems.id, productMaterialMappings.materialId))
      .leftJoin(rooms, eq(materialScheduleItems.roomId, rooms.id))
      .where(and(eq(materialScheduleItems.isPurchased, false), isNull(productMaterialMappings.materialId))),
  ]);

  const materialsNeedingProduct = materialsNeedingProductRows.map((m) => ({
    materialId: m.id,
    title: m.title,
    roomName: m.roomName ?? null,
  }));

  const categories = [
    ...distinctTypes
      .map((r) => r.productType)
      .filter((v): v is string => v != null)
      .map((v) => ({ value: v, label: v })),
    ...categoryRows.map((r) => ({ value: `category:${r.id}`, label: r.name })),
  ];

  return c.json({
    rooms: activeRooms.map((r) => ({ id: r.id, roomName: r.roomName })),
    categories,
    materialsNeedingProduct,
  });
});
