/**
 * @fileoverview Showroom Catalog API
 *
 * Flat, cross-store product catalog with filters. Mounts on /api/showroom-stores
 * under a /catalog/* prefix to avoid colliding with the dynamic /:id route on
 * the main showroom-stores router.
 *
 *   GET /catalog/products?search=&hub=&linked=
 *   GET /catalog/compare?ids=1,2,3
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, inArray, isNotNull, isNull, like, or } from "drizzle-orm";

import {
  showroomStoreProducts,
  showroomStores,
  storeBayareaCities,
  productSpecs,
} from "@backend/db/schema/showroom/index";

export const showroomCatalogRouter = new Hono<{ Bindings: Env }>();

/**
 * GET /catalog/products — flat product catalog across all stores.
 * Filters: ?search= (item name / sku), ?hub=A..E, ?linked=yes|no (material link).
 */
showroomCatalogRouter.get("/catalog/products", async (c) => {
  const db = drizzle(c.env.DB);
  const search = c.req.query("search");
  const hub = c.req.query("hub");
  const linked = c.req.query("linked");

  let query = db
    .select({
      product: showroomStoreProducts,
      storeName: showroomStores.name,
      pricePoint: showroomStores.pricePoint,
      hubRoute: storeBayareaCities.hubRoute,
      hubName: storeBayareaCities.hubName,
      cityName: storeBayareaCities.bayAreaCityName,
    })
    .from(showroomStoreProducts)
    .leftJoin(showroomStores, eq(showroomStoreProducts.storeId, showroomStores.id))
    .leftJoin(storeBayareaCities, eq(showroomStores.bayAreaCityId, storeBayareaCities.id))
    .orderBy(desc(showroomStoreProducts.createdAt))
    .$dynamic();

  const conditions = [];
  if (search) {
    conditions.push(
      or(
        like(showroomStoreProducts.itemName, `%${search}%`),
        like(showroomStoreProducts.sku, `%${search}%`),
      ),
    );
  }
  if (hub) conditions.push(eq(storeBayareaCities.hubRoute, hub));
  if (linked === "yes") conditions.push(isNotNull(showroomStoreProducts.materialId));
  if (linked === "no") conditions.push(isNull(showroomStoreProducts.materialId));
  if (conditions.length > 0) query = query.where(and(...conditions));

  const rows = await query;

  return c.json({
    products: rows.map((r) => ({
      ...r.product,
      storeName: r.storeName,
      pricePoint: r.pricePoint,
      hubRoute: r.hubRoute,
      hubName: r.hubName,
      cityName: r.cityName,
    })),
  });
});

/**
 * GET /catalog/compare?ids=1,2,3 — side-by-side comparison of selected products.
 * Returns the products (with store name) and a unified spec matrix keyed by
 * spec key, so the frontend can render rows = specs, columns = products.
 */
showroomCatalogRouter.get("/catalog/compare", async (c) => {
  const db = drizzle(c.env.DB);
  const idsRaw = c.req.query("ids") ?? "";
  const ids = idsRaw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (ids.length === 0) {
    return c.json({ products: [], specKeys: [], specMatrix: {} });
  }

  const rows = await db
    .select({ product: showroomStoreProducts, storeName: showroomStores.name })
    .from(showroomStoreProducts)
    .leftJoin(showroomStores, eq(showroomStoreProducts.storeId, showroomStores.id))
    .where(inArray(showroomStoreProducts.id, ids));

  const specRows = await db
    .select({
      storeProductId: productSpecs.storeProductId,
      specKey: productSpecs.specKey,
      specValue: productSpecs.specValue,
      unit: productSpecs.unit,
    })
    .from(productSpecs)
    .where(inArray(productSpecs.storeProductId, ids));

  // specMatrix[specKey][productId] = "value unit"
  const specMatrix: Record<string, Record<number, string>> = {};
  for (const s of specRows) {
    const key = s.specKey;
    specMatrix[key] = specMatrix[key] ?? {};
    specMatrix[key][s.storeProductId] = `${s.specValue ?? ""}${s.unit ? ` ${s.unit}` : ""}`.trim();
  }

  // Preserve the caller's requested order.
  const byId = new Map(rows.map((r) => [r.product.id, r]));
  const products = ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map((r) => ({ ...r.product, storeName: r.storeName }));

  return c.json({ products, specKeys: Object.keys(specMatrix).sort(), specMatrix });
});
