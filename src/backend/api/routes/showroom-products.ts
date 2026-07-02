/**
 * @fileoverview Showroom Products Search API
 *
 * Global product-search endpoint used by the associate-products autocomplete
 * when the homeowner links a product from a showroom's catalogue to another
 * showroom via `showroom_product_mappings`.
 *
 * Mounts at /api/showroom-products (wired in api/index.ts).
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { like, eq } from "drizzle-orm";
import { z } from "zod";

import {
  showroomStoreProducts,
} from "@backend/db/schema/showroom/index";
import { brands } from "@backend/db/schema/brands/index";

export const showroomProductsRouter = new OpenAPIHono<{ Bindings: Env }>();

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
