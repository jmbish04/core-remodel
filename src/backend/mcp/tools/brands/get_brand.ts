import { brands, showroomBrandMappings, showroomStores, showroomStoreProducts } from "@backend/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { brandDto, brandOutputShape } from "./_shared";

export const getBrand = defineTool({
    name: "get_brand",
    category: "brands",
    title: "Get brand detail",
    description:
      "Full detail for one brand by `id` or `name` (exact match): the brand row plus the showroom locations that carry it (via showroom_brand_mappings → showroom_stores) and the products attributed to this brand (showroom_store_products where brandId = this brand).",
    inputShape: {
      id: z.number().int().positive().optional(),
      name: z.string().optional().describe("Exact brand name (case-insensitive)"),
    },
    annotations: READ_ONLY,
    outputShape: {
      ...brandOutputShape,
      showrooms: z.array(looseObject({ id: z.number().int(), name: z.string() })),
      products: z.array(looseObject({ id: z.number().int(), itemName: z.string() })),
    },
    examples: [
      { title: "By id", args: { id: 1 } },
      { title: "By name", args: { name: "Waterworks" } },
    ],
    handler: async ({ db }, input) => {
      if (input.id == null && !input.name) {
        toolError("Provide either `id` or `name`.");
      }

      let brand: typeof brands.$inferSelect | undefined;
      if (input.id != null) {
        [brand] = await db.select().from(brands).where(eq(brands.id, input.id)).limit(1);
      } else {
        // Case-insensitive exact-name lookup: pull candidates and compare in JS.
        const target = (input.name as string).trim().toLowerCase();
        const all = await db.select().from(brands).all();
        brand = all.find((b) => b.name.trim().toLowerCase() === target);
      }
      if (!brand) {
        toolError(`Brand not found (${input.id ?? input.name}). Call list_brands for valid ids.`);
      }

      // Showrooms carrying this brand (join mappings → stores).
      const mappings = await db
        .select({ showroomId: showroomBrandMappings.showroomId })
        .from(showroomBrandMappings)
        .where(eq(showroomBrandMappings.brandId, brand.id))
        .all();
      const showroomIds = mappings.map((m) => m.showroomId);
      const showroomRows = showroomIds.length
        ? await db
            .select({ id: showroomStores.id, name: showroomStores.name })
            .from(showroomStores)
            .where(
              and(
                inArray(showroomStores.id, showroomIds),
                eq(showroomStores.isActive, true),
              ),
            )
            .all()
        : [];

      // Products attributed to this brand.
      const products = await db
        .select({ id: showroomStoreProducts.id, itemName: showroomStoreProducts.itemName })
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.brandId, brand.id))
        .all();

      return {
        ...brandDto(brand),
        showrooms: showroomRows.map((s) => ({ id: s.id, name: s.name })),
        products: products.map((p) => ({ id: p.id, itemName: p.itemName })),
      };
    },
  });
