import {
  brands,
  materialScheduleItems,
  productMaterialMappings,
  productPriceObservations,
  productShowroomPhotos,
  showroomProductMappings,
  showroomStoreProducts,
  showroomStores,
} from "@backend/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { productDto, productOutputShape } from "./_shared";

export const getProduct = defineTool({
    name: "get_product",
    category: "products",
    title: "Get product detail",
    description:
      "Full detail for one product by `id`: the product row, its brand (name), the material-schedule items it is linked to (both the many-to-many product_material_mappings rows AND the legacy/denormalized primary `materialId`), the showrooms that carry it (every showroom_product_mappings location, with store names — a product has no owning store), its `priceObservations` (every recorded price across showrooms/retailers/manufacturer), and its `photos` (product_showroom_photos rows).",
    inputShape: {
      id: z.number().int().positive().describe("Product id (from list_products)"),
    },
    annotations: READ_ONLY,
    outputShape: {
      ...productOutputShape,
      brand: looseObject({ id: z.number().int(), name: z.string() }).nullable(),
      materials: z.array(
        looseObject({
          materialId: z.number().int(),
          title: z.string().nullable(),
          roomName: z.string().nullable(),
          isPrimary: z.boolean(),
          viaJoinTable: z.boolean(),
          viaLegacyPointer: z.boolean(),
        }),
      ),
      showrooms: z.array(
        looseObject({
          showroomId: z.number().int(),
          name: z.string().nullable(),
          isOwningStore: z.boolean(),
          viaMapping: z.boolean(),
        }),
      ),
    },
    examples: [{ title: "By id", args: { id: 12 } }],
    handler: async ({ db }, input) => {
      const [product] = await db
        .select()
        .from(showroomStoreProducts)
        .where(eq(showroomStoreProducts.id, input.id))
        .limit(1);
      if (!product) toolError(`Product ${input.id} not found. Call list_products for valid ids.`);

      // Brand (name) — nullable.
      let brand: { id: number; name: string } | null = null;
      if (product.brandId != null) {
        const [b] = await db.select().from(brands).where(eq(brands.id, product.brandId)).limit(1);
        if (b) brand = { id: b.id, name: b.name };
      }

      // Linked materials: union of the join-table rows + the legacy primary.
      const matLinks = await db
        .select()
        .from(productMaterialMappings)
        .where(eq(productMaterialMappings.productId, product.id))
        .all();
      const matIds = new Set<number>(matLinks.map((m) => m.materialId));
      if (product.materialId != null) matIds.add(product.materialId);
      const matRows =
        matIds.size > 0
          ? await db
              .select()
              .from(materialScheduleItems)
              .where(inArray(materialScheduleItems.id, [...matIds]))
              .all()
          : [];
      const matById = new Map(matRows.map((m) => [m.id, m]));
      const materials = [...matIds].map((mid) => {
        const link = matLinks.find((l) => l.materialId === mid);
        const m = matById.get(mid);
        return {
          materialId: mid,
          title: m?.title ?? null,
          roomId: m?.roomId ?? null,
          isPrimary: link ? link.isPrimary : product.materialId === mid,
          viaJoinTable: Boolean(link),
          viaLegacyPointer: product.materialId === mid,
        };
      });

      // Showrooms carrying the product: purely from showroom_product_mappings
      // (a product has no owning store — it is global).
      const showroomLinks = await db
        .select()
        .from(showroomProductMappings)
        .where(eq(showroomProductMappings.productId, product.id))
        .all();
      const showroomIds = new Set<number>(showroomLinks.map((s) => s.showroomId));
      const storeRows =
        showroomIds.size > 0
          ? await db
              .select()
              .from(showroomStores)
              .where(
                and(
                  inArray(showroomStores.id, [...showroomIds]),
                  eq(showroomStores.isActive, true),
                ),
              )
              .all()
          : [];
      const storeById = new Map(storeRows.map((s) => [s.id, s]));
      const showrooms = [...showroomIds].map((sid) => ({
        id: sid,
        name: storeById.get(sid)?.name ?? null,
      }));

      const priceObservations = await db
        .select()
        .from(productPriceObservations)
        .where(eq(productPriceObservations.productId, product.id))
        .all();

      const photos = await db
        .select()
        .from(productShowroomPhotos)
        .where(eq(productShowroomPhotos.productId, product.id))
        .all();

      return {
        ...productDto(product),
        brand,
        materials,
        showrooms,
        priceObservations,
        photos,
      };
    },
  });
