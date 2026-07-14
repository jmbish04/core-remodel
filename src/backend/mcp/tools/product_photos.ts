/**
 * @fileoverview MCP tools — Showroom Product Photo HITL review.
 *
 * `product_showroom_photos` rows are written by the AI ingest pipeline
 * (`POST /api/product-photos/ingest`, see `services/image-processor/product-extraction.ts`)
 * with `status='pending_review'`. These tools are the human-in-the-loop backstop:
 * confirm/correct the AI-extracted `attributes`, reassign a mis-matched `productId`,
 * and approve or reject the price observation the ingest pipeline may have recorded
 * alongside the photo.
 *
 * `reviewProductPhotoCore` is the single implementation shared by the
 * `review_product_photo` tool AND its REST twin (`POST /api/product-photos/:id/review`,
 * see `api/routes/product-photos.ts`) — one place to get the approve/reject rules right.
 */
import { productPriceObservations, productShowroomPhotos, showroomStoreProducts } from "@backend/db";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { matchesQuery, paginate, toolError } from "../format";
import { looseObject, pageOutput, urlField } from "../schemas";
import { productsUrl } from "../urls";
import { defineTool, READ_ONLY, WRITE, type RemodelDb, type RemodelTool } from "../types";

/** Input accepted by `reviewProductPhotoCore` (mirrors the tool's inputShape). */
export interface ReviewProductPhotoInput {
  photoId: number;
  action: "approve" | "reject";
  reviewReason?: string;
  attributes?: Record<string, unknown>;
  productId?: number;
  observationApproved?: boolean;
}

/**
 * Approve or reject a pending product photo, and cascade the decision onto its
 * linked price observation (found via `productPriceObservations.sourcePhotoId`):
 *   - approve: sets `photo.status='approved'`; applies `attributes`/`productId`
 *     edits when passed; approves the linked observation ONLY when
 *     `observationApproved` is true.
 *   - reject: sets `photo.status='rejected'` + `reviewReason`; ALWAYS rejects
 *     any linked observation too (a rejected source photo can't back a price).
 */
export async function reviewProductPhotoCore(db: RemodelDb, input: ReviewProductPhotoInput) {
  const [photo] = await db
    .select()
    .from(productShowroomPhotos)
    .where(eq(productShowroomPhotos.id, input.photoId))
    .limit(1);
  if (!photo) toolError(`Product photo ${input.photoId} not found. Call list_pending_product_photos for valid ids.`);

  const now = new Date();
  const patch: Record<string, unknown> = {
    status: input.action === "approve" ? "approved" : "rejected",
    reviewedAt: now,
    updatedAt: now,
  };
  if (input.reviewReason !== undefined) patch.reviewReason = input.reviewReason;
  if (input.attributes !== undefined) patch.attributes = input.attributes;
  if (input.productId !== undefined) patch.productId = input.productId;

  await db.update(productShowroomPhotos).set(patch).where(eq(productShowroomPhotos.id, input.photoId)).run();
  const [updatedPhoto] = await db
    .select()
    .from(productShowroomPhotos)
    .where(eq(productShowroomPhotos.id, input.photoId))
    .limit(1);

  const [linkedObservation] = await db
    .select()
    .from(productPriceObservations)
    .where(eq(productPriceObservations.sourcePhotoId, input.photoId))
    .limit(1);

  let observation: typeof productPriceObservations.$inferSelect | null = linkedObservation ?? null;
  if (linkedObservation) {
    if (input.action === "reject") {
      const obsPatch = { reviewStatus: "rejected" as const, reviewedAt: now, updatedAt: now };
      await db.update(productPriceObservations).set(obsPatch).where(eq(productPriceObservations.id, linkedObservation.id)).run();
      observation = { ...linkedObservation, ...obsPatch };
    } else if (input.observationApproved) {
      const obsPatch = { reviewStatus: "approved" as const, reviewedAt: now, updatedAt: now };
      await db.update(productPriceObservations).set(obsPatch).where(eq(productPriceObservations.id, linkedObservation.id)).run();
      observation = { ...linkedObservation, ...obsPatch };
    }
  }

  return { photo: updatedPhoto, observation };
}

export const productPhotoTools: RemodelTool[] = [
  defineTool({
    name: "review_product_photo",
    category: "products",
    title: "Review a product photo (approve/reject)",
    description:
      "HITL review of an AI-extracted showroom product photo (`product_showroom_photos`). `approve` accepts the photo — optionally overwriting the AI's `attributes` and/or reassigning it to a different/confirmed `productId` — and, only when `observationApproved` is true, also approves its linked price observation (if one exists). `reject` marks the photo rejected with `reviewReason` and ALWAYS rejects any linked price observation, since a rejected source photo can't back a price.",
    inputShape: {
      photoId: z.number().int().positive().describe("Photo id (from list_pending_product_photos)"),
      action: z.enum(["approve", "reject"]).describe("approve or reject"),
      reviewReason: z.string().optional().describe("Why rejected (or a note on approval)"),
      attributes: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Edited AI-extraction payload to overwrite the stored attributes JSON"),
      productId: z.number().int().positive().optional().describe("Reassign the photo to a different/confirmed product id"),
      observationApproved: z
        .boolean()
        .optional()
        .describe("On approve, also approve the linked price observation (if one exists)"),
    },
    annotations: WRITE,
    outputShape: {
      photo: looseObject({
        id: z.number().int(),
        status: z.string(),
        productId: z.number().int(),
        reviewReason: z.string().nullable(),
      }),
      observation: looseObject({ id: z.number().int(), reviewStatus: z.string() }).nullable(),
      url: urlField,
    },
    examples: [
      { title: "Approve as-is", args: { photoId: 5, action: "approve" } },
      {
        title: "Approve + reassign product + approve price",
        args: { photoId: 5, action: "approve", productId: 12, observationApproved: true },
      },
      { title: "Reject", args: { photoId: 5, action: "reject", reviewReason: "Blurry, unreadable" } },
    ],
    handler: async ({ env, db }, input) => {
      const result = await reviewProductPhotoCore(db, input);
      return { ...result, url: productsUrl(env, result.photo.productId ?? undefined) };
    },
  }),

  defineTool({
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
  }),
];
