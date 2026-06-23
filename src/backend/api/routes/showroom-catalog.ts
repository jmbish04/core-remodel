/**
 * @fileoverview Showroom Catalog API
 *
 * Flat, cross-store product catalog with filters. Mounts on /api/showroom-stores
 * under a /catalog/* prefix to avoid colliding with the dynamic /:id route on
 * the main showroom-stores router.
 *
 *   GET /catalog/products?search=&hub=&linked=
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, isNotNull, isNull, like, or } from "drizzle-orm";

import {
  showroomStoreProducts,
  showroomStores,
  storeBayareaCities,
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
