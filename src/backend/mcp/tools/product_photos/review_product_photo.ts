/**
 * @fileoverview MCP tool — Showroom Product Photo HITL review (approve/reject).
 *
 * `reviewProductPhotoCore` is the single implementation shared by the
 * `review_product_photo` tool AND its REST twin (`POST /api/product-photos/:id/review`,
 * see `api/routes/product-photos.ts`) — one place to get the approve/reject rules right.
 */
import { productPriceObservations, productShowroomPhotos } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { productsUrl } from "../../urls";
import { defineTool, WRITE, type RemodelDb } from "../../types";

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

export const reviewProductPhoto = defineTool({
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
  });
