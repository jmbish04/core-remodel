/**
 * @fileoverview Showroom Products API
 *
 * Global product endpoints:
 *   GET /        — full product grid (all brands, all stores, all types)
 *   GET /search  — autocomplete LIKE search for associate-products UI
 *
 * Mounts at /api/showroom-products (wired in api/index.ts).
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { like, eq, desc, and, inArray, or } from "drizzle-orm";
import { z } from "zod";

import {
  showroomStoreProducts,
  productImages,
  storeProductRating,
} from "@backend/db/schema/showroom/index";
import { brands } from "@backend/db/schema/brands/index";
import { showroomStores } from "@backend/db/schema/showroom/stores";

export const showroomProductsRouter = new OpenAPIHono<{ Bindings: Env }>();

// ─── GET / ────────────────────────────────────────────────────────────────────

/**
 * GET /?search=<term> — Global product grid for /admin/products.
 *
 * Returns every showroom_store_products row joined to:
 *   - brand name (via brandId → brands.name)
 *   - store name (via storeId → showroom_stores.name)
 *   - newest product image (productImages.deliveryUrl, newest createdAt)
 *   - active user rating (storeProductRating where isActive=true)
 *
 * Optional `?search=` filters by itemName OR brand name (LIKE).
 * Results are ordered by product id DESC (newest first).
 *
 * `onlineRating` is null for now — no product-level online rating is stored.
 *
 * Response 200:
 *   {
 *     "products": [
 *       {
 *         "id": 42,
 *         "name": "Harrington Bridge Faucet",
 *         "brandId": 3,
 *         "brandName": "Waterworks",
 *         "storeId": 7,
 *         "storeName": "Studio Belmont SF",
 *         "productType": "Faucet",
 *         "imageUrl": "https://imagedelivery.net/.../public",
 *         "userRating": 4,
 *         "onlineRating": null
 *       },
 *       ...
 *     ]
 *   }
 */
showroomProductsRouter.get("/", async (c) => {
  const search = (c.req.query("search") ?? "").trim();
  const db = drizzle(c.env.DB);

  // 1. Fetch all products with brand + store names in a single join.
  //    Optional search filter applies an OR across itemName and brand name.
  let baseQuery = db
    .select({
      id: showroomStoreProducts.id,
      itemName: showroomStoreProducts.itemName,
      brandId: showroomStoreProducts.brandId,
      brandName: brands.name,
      storeId: showroomStoreProducts.storeId,
      storeName: showroomStores.name,
      productType: showroomStoreProducts.productType,
    })
    .from(showroomStoreProducts)
    .leftJoin(brands, eq(showroomStoreProducts.brandId, brands.id))
    .leftJoin(showroomStores, eq(showroomStoreProducts.storeId, showroomStores.id))
    .orderBy(desc(showroomStoreProducts.id))
    .$dynamic();

  if (search.length > 0) {
    baseQuery = baseQuery.where(
      or(
        like(showroomStoreProducts.itemName, `%${search}%`),
        like(brands.name, `%${search}%`),
      ),
    );
  }

  const products = await baseQuery;

  if (products.length === 0) {
    return c.json({ products: [] });
  }

  const ids = products.map((p) => p.id);

  // 2. Newest image per product + active user rating — both fetched in parallel.
  //    Using inArray + sorting in JS avoids N+1 queries and complex GROUP BY.
  const [allImages, activeRatings] = await Promise.all([
    db
      .select({
        storeProductId: productImages.storeProductId,
        deliveryUrl: productImages.deliveryUrl,
      })
      .from(productImages)
      .where(inArray(productImages.storeProductId, ids))
      .orderBy(desc(productImages.createdAt)),
    db
      .select({
        storeProductId: storeProductRating.storeProductId,
        rating: storeProductRating.rating,
      })
      .from(storeProductRating)
      .where(
        and(
          eq(storeProductRating.isActive, true),
          inArray(storeProductRating.storeProductId, ids),
        ),
      ),
  ]);

  // 3. Build lookup maps. allImages is DESC by createdAt; first hit wins.
  const imageMap = new Map<number, string>();
  for (const row of allImages) {
    if (!imageMap.has(row.storeProductId)) {
      imageMap.set(row.storeProductId, row.deliveryUrl);
    }
  }

  const ratingMap = new Map<number, number>();
  for (const row of activeRatings) {
    ratingMap.set(row.storeProductId, row.rating);
  }

  return c.json({
    products: products.map((p) => ({
      id: p.id,
      name: p.itemName,
      brandId: p.brandId ?? null,
      brandName: p.brandName ?? null,
      storeId: p.storeId,
      storeName: p.storeName ?? null,
      productType: p.productType ?? null,
      imageUrl: imageMap.get(p.id) ?? null,
      userRating: ratingMap.get(p.id) ?? null,
      onlineRating: null as null,
    })),
  });
});

// ─── GET /search ─────────────────────────────────────────────────────────────

/**
 * GET /search?q=<term>
 *
 * Full-text LIKE search across all showroom products by item name. Empty `q`
 * returns an empty list immediately (no DB hit). Results are capped at 20 rows
 * and joined to the owning brand so the UI can show brand context in the
 * autocomplete dropdown.
 *
 * Request:
 *   GET /api/showroom-products/search?q=faucet
 *
 * Response 200:
 *   {
 *     "products": [
 *       {
 *         "id": 42,
 *         "itemName": "Harrington Bridge Faucet",
 *         "storeId": 7,
 *         "brandId": 3,
 *         "brandName": "Waterworks"
 *       },
 *       ...
 *     ]
 *   }
 */
showroomProductsRouter.get("/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();

  // Guard: return empty list immediately for empty queries — avoids a
  // full-table LIKE scan and keeps autocomplete debounce logic simple.
  if (q.length === 0) {
    return c.json({ products: [] });
  }

  const db = drizzle(c.env.DB);

  const rows = await db
    .select({
      id: showroomStoreProducts.id,
      itemName: showroomStoreProducts.itemName,
      storeId: showroomStoreProducts.storeId,
      brandId: showroomStoreProducts.brandId,
      brandName: brands.name,
    })
    .from(showroomStoreProducts)
    .leftJoin(brands, eq(showroomStoreProducts.brandId, brands.id))
    .where(like(showroomStoreProducts.itemName, `%${q}%`))
    .limit(20);

  return c.json({
    products: rows.map((r) => ({
      id: r.id,
      itemName: r.itemName,
      storeId: r.storeId,
      brandId: r.brandId ?? null,
      brandName: r.brandName ?? null,
    })),
  });
});

// Quick validation guard — used in test/type assertions only; not exported
export const _productSearchResponseShape = z.object({
  products: z.array(
    z.object({
      id: z.number(),
      itemName: z.string(),
      storeId: z.number(),
      brandId: z.number().nullable(),
      brandName: z.string().nullable(),
    }),
  ),
});
