import { showroomProductMappings, showroomStoreProducts, showroomStores } from "@backend/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { productsUrl } from "../../urls";
import { defineTool, WRITE_IDEMPOTENT, type RemodelDb } from "../../types";

/** Confirm a showroom (store) row exists. */
async function assertStore(db: RemodelDb, showroomId: number) {
  const [row] = await db.select().from(showroomStores).where(eq(showroomStores.id, showroomId)).limit(1);
  if (!row) toolError(`Showroom ${showroomId} not found. Call list_showrooms for valid ids.`);
  return row;
}

export const linkProductToShowroom = defineTool({
    name: "link_product_to_showroom",
    category: "products",
    title: "Link product to showroom",
    description:
      "Record that a showroom LOCATION carries a product — upserts a `showroom_product_mappings` row. Idempotent: if the (showroomId, productId) pair already exists it is a no-op (`linked:false`). Both the product and the showroom are validated to exist.",
    inputShape: {
      productId: z.number().int().positive().describe("Product id (from list_products)"),
      showroomId: z.number().int().positive().describe("Showroom store id (from list_showrooms)"),
    },
    annotations: WRITE_IDEMPOTENT,
    outputShape: {
      linked: z.boolean(),
      mapping: looseObject({
        id: z.number().int(),
        showroomId: z.number().int(),
        productId: z.number().int(),
      }),
      url: urlField,
    },
    examples: [{ title: "Carry a product", args: { productId: 12, showroomId: 3 } }],
    handler: async ({ env, db }, input) => {
      const [product] = await db
        .select()
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.id, input.productId))
        .limit(1);
      if (!product) toolError(`Product ${input.productId} not found. Call list_products for valid ids.`);
      await assertStore(db, input.showroomId);

      const [existing] = await db
        .select()
        .from(showroomProductMappings)
        .where(
          and(
            eq(showroomProductMappings.showroomId, input.showroomId),
            eq(showroomProductMappings.productId, input.productId),
          ),
        )
        .limit(1);
      if (existing) return { linked: false, mapping: existing, url: productsUrl(env, input.productId) };

      const [mapping] = await db
        .insert(showroomProductMappings)
        .values({ showroomId: input.showroomId, productId: input.productId })
        .returning();
      return { linked: true, mapping, url: productsUrl(env, input.productId) };
    },
  });
