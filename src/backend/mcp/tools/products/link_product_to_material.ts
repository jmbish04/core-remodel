import { productMaterialMappings, showroomStoreProducts } from "@backend/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { productsUrl } from "../../urls";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";
import { assertMaterial } from "./_shared";

export const linkProductToMaterial = defineTool({
    name: "link_product_to_material",
    category: "products",
    title: "Link product to material",
    description:
      "Record that a product satisfies a material-schedule item — upserts a `product_material_mappings` row. Idempotent: an existing (productId, materialId) pair is a no-op (`linked:false`), though `isPrimary` is still applied if requested. When `isPrimary` is true, ALSO sets the product's denormalized `showroom_store_products.materialId` pointer to this material. Both the product and the material are validated to exist.",
    inputShape: {
      productId: z.number().int().positive().describe("Product id (from list_products)"),
      materialId: z.number().int().positive().describe("Material-schedule item id (from list_materials)"),
      isPrimary: z
        .boolean()
        .optional()
        .describe("Mark this material as the product's principal one; also sets the legacy materialId pointer"),
    },
    annotations: WRITE_IDEMPOTENT,
    outputShape: {
      linked: z.boolean(),
      isPrimary: z.boolean(),
      primaryPointerUpdated: z.boolean(),
      mapping: looseObject({
        id: z.number().int(),
        productId: z.number().int(),
        materialId: z.number().int(),
        isPrimary: z.boolean(),
      }),
      url: urlField,
    },
    examples: [
      { title: "Link", args: { productId: 12, materialId: 7 } },
      { title: "Link as primary", args: { productId: 12, materialId: 7, isPrimary: true } },
    ],
    handler: async ({ env, db }, input) => {
      const [product] = await db
        .select()
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.id, input.productId))
        .limit(1);
      if (!product) toolError(`Product ${input.productId} not found. Call list_products for valid ids.`);
      await assertMaterial(db, input.materialId);

      const isPrimary = input.isPrimary === true;

      const [existing] = await db
        .select()
        .from(productMaterialMappings)
        .where(
          and(
            eq(productMaterialMappings.productId, input.productId),
            eq(productMaterialMappings.materialId, input.materialId),
          ),
        )
        .limit(1);

      let mapping = existing;
      let linked = false;
      if (existing) {
        // No-op on the join row, but honor an isPrimary upgrade.
        if (isPrimary && !existing.isPrimary) {
          await db
            .update(productMaterialMappings)
            .set({ isPrimary: true })
            .where(eq(productMaterialMappings.id, existing.id))
            .run();
          mapping = { ...existing, isPrimary: true };
        }
      } else {
        const [created] = await db
          .insert(productMaterialMappings)
          .values({ productId: input.productId, materialId: input.materialId, isPrimary })
          .returning();
        mapping = created;
        linked = true;
      }

      // Denormalized primary pointer on the product row.
      let primarySet = false;
      if (isPrimary && product.materialId !== input.materialId) {
        await db
          .update(showroomStoreProducts)
          .set({ materialId: input.materialId, updatedAt: new Date() })
          .where(eq(showroomStoreProducts.id, input.productId))
          .run();
        primarySet = true;
      }

      return {
        linked,
        isPrimary,
        primaryPointerUpdated: primarySet,
        mapping,
        url: productsUrl(env, input.productId),
      };
    },
  });
