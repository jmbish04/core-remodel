/**
 * @fileoverview Photo reviews API routes
 *
 * Handles the photo review workflow migrated from the Python app:
 * - List all reviews grouped by room
 * - Upload new photos (Cloudflare Images + AI analysis via ImageProcessorService)
 * - Update review metadata
 *
 * All image storage uses Cloudflare Images. No R2.
 * All AI analysis flows through ImageProcessorService which uses:
 *   Vision: llama-3.2-11b-vision-instruct
 *   Reasoning: gpt-oss-120b with json_schema structured output
 */

import { eq, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import { imageReviews } from "@backend/db";
import {
  buildImageUploadFingerprint,
  findDuplicateImageByFingerprint,
} from "@/services/image-processor/deduplication";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";
import { ImageProcessorService } from "../../services/image-processor";

const photoReviewsRouter = new Hono<{ Bindings: Env }>();

/**
 * GET /api/photo-reviews
 * Returns all image reviews, grouped by room (like the python app)
 */
photoReviewsRouter.get("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const allImages = await db
      .select()
      .from(imageReviews)
      .orderBy(asc(imageReviews.filename));

    // Group by room
    const groupsMap = new Map<string, typeof allImages>();
    for (const img of allImages) {
      const room = img.room || "unassigned";
      if (!groupsMap.has(room)) {
        groupsMap.set(room, []);
      }
      groupsMap.get(room)!.push(img);
    }

    const groups = Array.from(groupsMap.entries())
      .map(([room, images]) => ({ room, images }))
      .sort((a, b) => a.room.localeCompare(b.room));

    return c.json({
      images: allImages,
      groups,
    });
  } catch (error) {
    console.error("List photo reviews error:", error);
    return c.json({ error: "Failed to list images" }, 500);
  }
});

/**
 * POST /api/photo-reviews/upload
 * Upload an image to Cloudflare Images, use Workers AI to tag it, save to D1.
 * Delegates all processing to ImageProcessorService.
 */
photoReviewsRouter.post("/upload", async (c) => {
  try {
    const formData = await c.req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return c.json({ error: "No file provided" }, 400);
    }

    const db = drizzle(c.env.DB);
    const uploadFingerprint = await buildImageUploadFingerprint(file);
    const duplicateImage = await findDuplicateImageByFingerprint(
      db,
      uploadFingerprint,
    );
    if (duplicateImage) {
      return c.json(
        {
          error: "Duplicate image already exists",
          duplicate: true,
          duplicateImageId: duplicateImage.id,
          image: duplicateImage,
        },
        409,
      );
    }

    // Resolve credentials
    const credentials = await resolveCloudflareImagesCredentials(c.env);

    if (!credentials.accountId || credentials.apiTokens.length === 0) {
      return c.json(
        { error: "Cloudflare Images credentials not configured" },
        500,
      );
    }

    // Delegate to ImageProcessorService
    const processor = new ImageProcessorService(
      c.env,
      credentials.accountId,
      credentials.apiTokens[0],
      {
        fallbackApiTokens: credentials.apiTokens.slice(1),
      },
    );
    const result = await processor.processPhotoReview(file, {
      uploadFingerprint,
    });

    if (!result.success) {
      return c.json({ error: result.error || "Processing failed" }, 500);
    }

    return c.json({ success: true, image: result.record });
  } catch (error) {
    console.error("Upload error:", error);
    return c.json({ error: "Failed to upload and process image" }, 500);
  }
});

/**
 * POST /api/photo-reviews/:id
 * Update an existing photo review record
 */
photoReviewsRouter.post("/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = await c.req.json();
    const db = drizzle(c.env.DB);

    const existing = await db
      .select()
      .from(imageReviews)
      .where(eq(imageReviews.id, id))
      .get();
    if (!existing) {
      return c.json({ error: "Not found" }, 404);
    }

    const updates: any = { updatedAt: new Date() };
    if (body.room !== undefined) updates.room = body.room.toLowerCase();
    if (body.tags !== undefined) updates.tags = body.tags;
    if (body.note !== undefined) updates.note = body.note;
    if (body.reviewed !== undefined) updates.reviewed = body.reviewed ? 1 : 0;
    if (body.sourceFile !== undefined) updates.sourceFile = body.sourceFile;
    if (body.imageNumber !== undefined) updates.imageNumber = body.imageNumber;
    if (body.igAccount !== undefined) updates.igAccount = body.igAccount;
    if (body.visibleCaption !== undefined)
      updates.visibleCaption = body.visibleCaption;

    const [updated] = await db
      .update(imageReviews)
      .set(updates)
      .where(eq(imageReviews.id, id))
      .returning();

    if (!updated) {
      return c.json({ error: "Not found" }, 404);
    }

    return c.json({ success: true, image: updated });
  } catch (error) {
    console.error("Update error:", error);
    return c.json({ error: "Failed to update record" }, 500);
  }
});

// Note: The /image/:path endpoint has been removed.
// Images should be served directly from Cloudflare Images via the client using:
// https://imagedelivery.net/<ACCOUNT_HASH>/<IMAGE_ID>/<VARIANT>

export { photoReviewsRouter };
