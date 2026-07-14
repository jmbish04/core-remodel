import { showroomStoreProducts } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { productsUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";
import {
  assertBrand,
  assertMaterial,
  normalizeJsonDetails,
  normalizePrice,
  productDto,
  productOutputShape,
} from "./_shared";

export const updateProduct = defineTool({
    name: "update_product",
    category: "products",
    title: "Update product",
    description:
      "Patch any column of an existing product (`showroom_store_products`). Only the fields you pass are changed. `brandId`/`materialId` are validated when passed. `price` is free text (number coerced to string); `jsonDetails` accepts an object (JSON.stringify-ed) or a string. Does NOT touch the join tables — use link_product_to_showroom / link_product_to_material for those.",
    inputShape: {
      id: z.number().int().positive().describe("Product id (from list_products)"),
      itemName: z.string().min(1).optional(),
      brandId: z.number().int().positive().optional().describe("Brand id (validated)"),
      materialId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Primary/denormalized material id (validated)"),
      description: z.string().optional(),
      sku: z.string().optional(),
      price: z.union([z.string(), z.number()]).optional(),
      productType: z.string().optional(),
      colors: z.string().optional(),
      preferredColor: z.string().optional(),
      jsonDetails: z.union([z.record(z.string(), z.unknown()), z.string()]).optional(),
      notes: z.string().optional(),
      leadTime: z.string().optional(),
      possibleDiscounts: z.string().optional(),
      tradeDiscount: z.string().optional(),
    },
    annotations: WRITE,
    outputShape: {
      updated: z.boolean(),
      product: looseObject(productOutputShape),
      url: urlField,
    },
    examples: [
      { title: "Set price + sku", args: { id: 12, price: "$1,050", sku: "ABC-123" } },
      { title: "Categorize", args: { id: 12, productType: "Range" } },
    ],
    handler: async ({ env, db }, input) => {
      const { id, ...rest } = input;
      const [existing] = await db
        .select()
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.id, id))
        .limit(1);
      if (!existing) toolError(`Product ${id} not found. Call list_products for valid ids.`);

      if (rest.brandId != null) await assertBrand(db, rest.brandId);
      if (rest.materialId != null) await assertMaterial(db, rest.materialId);

      // Build the patch from only the passed fields, normalizing the two
      // special columns.
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) {
        if (v === undefined) continue;
        if (k === "price") patch.price = normalizePrice(v);
        else if (k === "jsonDetails") patch.jsonDetails = normalizeJsonDetails(v);
        else patch[k] = v;
      }
      if (Object.keys(patch).length === 0) toolError("No fields to update — pass at least one field.");
      patch.updatedAt = new Date();

      await db.update(showroomStoreProducts).set(patch).where(eq(showroomStoreProducts.id, id)).run();
      const [updated] = await db
        .select()
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.id, id))
        .limit(1);
      return { updated: true, product: productDto(updated), url: productsUrl(env, id) };
    },
  });
