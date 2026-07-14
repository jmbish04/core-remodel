import { showroomProductMappings, showroomStoreProducts } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { matchesQuery, paginate } from "../../format";
import { looseObject, pageOutput } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { productDto, productOutputShape } from "./_shared";

export const listProducts = defineTool({
    name: "list_products",
    category: "products",
    title: "List products",
    description:
      "List the global product catalog (`showroom_store_products`). Optional filters: `brandId`, `materialId` (the product's primary/denormalized material pointer), `showroomId` (products carried at a showroom via the showroom_product_mappings join), `productType` (coarse category like 'Faucet'), and free-text `q` over itemName/description/sku. Paginated. Use a product's `id` as the target for get_product, update_product, and the link_* tools.",
    inputShape: {
      brandId: z.number().int().positive().optional().describe("Only products for this brand"),
      materialId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Only products whose primary materialId matches"),
      showroomId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Only products carried at this showroom (via showroom_product_mappings)"),
      productType: z.string().optional().describe("Exact coarse category, e.g. 'Faucet', 'Tile'"),
      q: z.string().optional().describe("Free-text filter over itemName / description / sku"),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: READ_ONLY,
    outputShape: { ...pageOutput(looseObject(productOutputShape)) },
    examples: [
      { title: "All products", args: {} },
      { title: "Faucets for a brand", args: { brandId: 4, productType: "Faucet" } },
    ],
    handler: async ({ db }, input) => {
      let rows = await db.select().from(showroomStoreProducts).all();

      if (input.brandId != null) rows = rows.filter((r) => r.brandId === input.brandId);
      if (input.materialId != null) rows = rows.filter((r) => r.materialId === input.materialId);
      if (input.productType) rows = rows.filter((r) => r.productType === input.productType);

      if (input.showroomId != null) {
        const links = await db
          .select({ productId: showroomProductMappings.productId })
          .from(showroomProductMappings)
          .where(eq(showroomProductMappings.showroomId, input.showroomId))
          .all();
        const ids = new Set(links.map((l) => l.productId));
        rows = rows.filter((r) => ids.has(r.id));
      }

      if (input.q) {
        rows = rows.filter((r) => matchesQuery([r.itemName, r.description, r.sku], input.q as string));
      }

      return paginate(rows.map(productDto), input.limit ?? 50, input.offset ?? 0);
    },
  });
