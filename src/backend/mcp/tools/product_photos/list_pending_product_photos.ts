/**
 * @fileoverview MCP tool — list showroom product photos awaiting HITL review.
 */
import { productPriceObservations, productShowroomPhotos, showroomStoreProducts } from "@backend/db";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { matchesQuery, paginate } from "../../format";
import { looseObject, pageOutput } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const listPendingProductPhotos = defineTool({
    name: "list_pending_product_photos",
    category: "products",
    title: "List pending product photos",
    description:
      "List showroom product photos awaiting HITL review (`product_showroom_photos.status='pending_review'`), joined to their product's name and any linked price observation. Optional free-text `q` filters by product item name. Paginated, newest first.",
    inputShape: {
      q: z.string().optional().describe("Free-text filter over the linked product's itemName"),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      ...pageOutput(
        looseObject({
          id: z.number().int(),
          ragUuid: z.string(),
          productId: z.number().int(),
          itemName: z.string().nullable(),
          showroomId: z.number().int().nullable(),
          imageUrl: z.string().nullable(),
          category: z.string().nullable(),
          photoKind: z.string(),
          status: z.string(),
          observation: looseObject({ id: z.number().int(), reviewStatus: z.string() }).nullable(),
        }),
      ),
    },
    examples: [{ title: "First page", args: {} }],
    handler: async ({ db }, input) => {
      const rows = await db
        .select()
        .from(productShowroomPhotos)
        .where(eq(productShowroomPhotos.status, "pending_review"))
        .orderBy(desc(productShowroomPhotos.createdAt))
        .all();
      if (rows.length === 0) return paginate([], input.limit ?? 50, input.offset ?? 0);

      const productIds = [
        ...new Set(rows.map((r) => r.productId).filter((id): id is number => id != null)),
      ];
      const photoIds = rows.map((r) => r.id);
      const [products, observations] = await Promise.all([
        db.select().from(showroomStoreProducts).where(inArray(showroomStoreProducts.id, productIds)).all(),
        db.select().from(productPriceObservations).where(inArray(productPriceObservations.sourcePhotoId, photoIds)).all(),
      ]);
      const productById = new Map(products.map((p) => [p.id, p]));
      const obsByPhotoId = new Map(observations.map((o) => [o.sourcePhotoId as number, o]));

      let items = rows.map((r) => ({
        id: r.id,
        ragUuid: r.ragUuid,
        productId: r.productId,
        itemName: (r.productId != null ? productById.get(r.productId)?.itemName : null) ?? null,
        showroomId: r.showroomId,
        imageUrl: r.imageUrl,
        category: r.category,
        photoKind: r.photoKind,
        status: r.status,
        observation: obsByPhotoId.get(r.id) ?? null,
      }));

      if (input.q) items = items.filter((r) => matchesQuery([r.itemName], input.q as string));

      return paginate(items, input.limit ?? 50, input.offset ?? 0);
    },
  });
