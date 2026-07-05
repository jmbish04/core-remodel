/**
 * @fileoverview Listing Photos API routes
 */

import { aiEdits, images, listingPhotos, rooms, listingPhotoBlankCanvases } from "@backend/db";
import { ensureHomeCatalogSeed } from "@backend/services/home-catalog";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";
import { and, eq, inArray, isNull, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import { ImageProcessorService } from "../../services/image-processor";
import { generateBlankCanvas, buildBlankCanvasPrompt } from "../../services/render/blank-canvas-generator";

const listingPhotosRouter = new Hono<{ Bindings: Env }>();

/**
 * GET /api/listing-photos
 * List all listing photos
 */
listingPhotosRouter.get("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photos = await db.select().from(listingPhotos).all();

    return c.json({
      success: true,
      count: photos.length,
      listingPhotos: photos,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list listing photos",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * POST /api/listing-photos/backfill
 * Auto-create listing_photos rows for listing images that don't have one.
 * This bridges the gap: images uploaded via the general pipeline get
 * photoCategory='listing' but no listing_photos record, which prevents
 * blank-canvas upload buttons from rendering.
 */
listingPhotosRouter.post("/backfill", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    await ensureHomeCatalogSeed(c.env);

    // Find listing images that already have a listing_photos row
    const existingRows = await db
      .select({ imageId: listingPhotos.imageId })
      .from(listingPhotos)
      .all();
    const linkedImageIds = new Set(
      existingRows
        .map((r) => r.imageId)
        .filter((id): id is string => typeof id === "string"),
    );

    // Fetch all listing images
    const listingImages = await db
      .select()
      .from(images)
      .where(
        and(
          eq(images.photoCategory, "listing"),
          eq(images.isDeleted, false),
          eq(images.isDuplicate, false),
        ),
      )
      .all();

    // Filter to only unlinked images
    const unlinked = listingImages.filter((img) => !linkedImageIds.has(img.id));

    if (unlinked.length === 0) {
      return c.json({ success: true, created: 0 });
    }

    // Resolve room names for the roomId on each image
    const roomIds = Array.from(
      new Set(
        unlinked
          .map((img) => img.roomId)
          .filter((id): id is number => typeof id === "number" && id > 0),
      ),
    );
    const roomRows =
      roomIds.length > 0
        ? await db.select().from(rooms).where(inArray(rooms.id, roomIds)).all()
        : [];
    const roomNameById = new Map(roomRows.map((r) => [r.id, r.roomName]));

    let created = 0;
    for (const img of unlinked) {
      const cfImageId = img.cfImageIdOriginal;
      if (!cfImageId) continue;

      const roomName =
        (img.roomId ? roomNameById.get(img.roomId) : null) ||
        img.roomType ||
        "Unassigned";

      await db
        .insert(listingPhotos)
        .values({
          imageId: img.id,
          cfImageId,
          roomId: img.roomId ?? null,
          roomName,
          description: img.displayName,
        })
        .onConflictDoNothing()
        .run();
      created++;
    }

    return c.json({ success: true, created });
  } catch (error) {
    return c.json(
      {
        error: "Failed to backfill listing photos",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * POST /api/listing-photos
 * Add a new listing photo
 */
listingPhotosRouter.post("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    await ensureHomeCatalogSeed(c.env);
    const contentType = c.req.header("content-type") || "";

    let imageId: string | null = null;
    let cfImageId = "";
    let roomId: number | null = null;
    let roomName = "";
    let description: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      const file = formData.get("file");
      const roomIdInput = formData.get("roomId");
      const descriptionInput = formData.get("description");

      if (!(file instanceof File)) {
        return c.json({ error: "file is required" }, 400);
      }

      const parsedRoomId = typeof roomIdInput === "string" ? Number(roomIdInput.trim()) : NaN;
      if (!Number.isFinite(parsedRoomId)) {
        return c.json({ error: "roomId is required" }, 400);
      }

      const selectedRoom = await db
        .select()
        .from(rooms)
        .where(eq(rooms.id, Math.trunc(parsedRoomId)))
        .get();

      if (!selectedRoom) {
        return c.json({ error: "Selected room not found" }, 404);
      }
      roomId = selectedRoom.id;
      roomName = selectedRoom.roomName;

      const credentials = await resolveCloudflareImagesCredentials(c.env);
      if (!credentials.accountId || credentials.apiTokens.length === 0) {
        return c.json({ error: "Cloudflare credentials not configured" }, 500);
      }

      const processor = new ImageProcessorService(
        c.env,
        credentials.accountId,
        credentials.apiTokens[0],
        {
          fallbackApiTokens: credentials.apiTokens.slice(1),
        },
      );
      const result = await processor.processImage(file, true, "listing", {
        roomAssignment: {
          roomId,
          roomType: roomName,
        },
      });
      if (!result.success || !result.imageId || !result.deliveryUrl) {
        return c.json({ error: result.error || "Failed to upload listing image" }, 500);
      }
      imageId = result.imageId;

      const deliveryParts = result.deliveryUrl.split("/").filter(Boolean);
      cfImageId =
        deliveryParts.length >= 4 ? `${deliveryParts[2]}/${deliveryParts[3]}` : result.imageId;
      description =
        typeof descriptionInput === "string" && descriptionInput.trim().length > 0
          ? descriptionInput.trim()
          : null;
    } else {
      const body = await c.req.json();
      imageId = body.imageId || null;
      cfImageId = body.cfImageId || "";
      roomId = Number(body.roomId);
      if (!Number.isFinite(roomId)) {
        return c.json({ error: "roomId is required" }, 400);
      }
      const selectedRoom = await db
        .select()
        .from(rooms)
        .where(eq(rooms.id, Math.trunc(roomId)))
        .get();
      if (!selectedRoom) {
        return c.json({ error: "Selected room not found" }, 404);
      }
      roomName = selectedRoom.roomName;
      description = body.description || null;
    }

    if (!cfImageId || !roomName || !roomId) {
      return c.json({ error: "cfImageId and roomId are required" }, 400);
    }

    const result = await db
      .insert(listingPhotos)
      .values({
        imageId,
        cfImageId,
        roomId,
        roomName,
        description,
      })
      .returning()
      .get();

    return c.json({
      success: true,
      listingPhoto: result,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to create listing photo",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * POST /api/listing-photos/:id/edit
 * Generate an AI-edited version of a listing photo
 */
listingPhotosRouter.post("/:id/edit", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photoId = parseInt(c.req.param("id"));
    const body = await c.req.json();

    const { prompt } = body;

    if (!prompt) {
      return c.json({ error: "Prompt is required" }, 400);
    }

    // Check if listing photo exists
    const listingPhoto = await db
      .select()
      .from(listingPhotos)
      .where(eq(listingPhotos.id, photoId))
      .get();

    if (!listingPhoto) {
      return c.json({ error: "Listing photo not found" }, 404);
    }

    // TODO: Implement actual AI image editing
    // For now, we'll create a placeholder record
    // In production, you would:
    // 1. Fetch the original image from Cloudflare Images
    // 2. Use Workers AI (e.g., FLUX model) to generate the edited version
    // 3. Upload the result to Cloudflare Images
    // 4. Store the reference in the aiEdits table

    const placeholderEditedImageId = `edited-${listingPhoto.cfImageId}-${Date.now()}`;

    const edit = await db
      .insert(aiEdits)
      .values({
        originalListingId: photoId,
        prompt,
        generatedCfImageId: placeholderEditedImageId,
      })
      .returning()
      .get();

    return c.json({
      success: true,
      message: "AI edit created (placeholder)",
      edit,
      note: "In production, this would generate an actual AI-edited image",
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to create AI edit",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * POST /api/listing-photos/:id/ai-renders
 * Upload an AI-rendered image of a listing photo
 */
listingPhotosRouter.post("/:id/ai-renders", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photoId = parseInt(c.req.param("id"));
    
    // Check if listing photo exists
    const listingPhoto = await db
      .select()
      .from(listingPhotos)
      .where(eq(listingPhotos.id, photoId))
      .get();

    if (!listingPhoto) {
      return c.json({ error: "Listing photo not found" }, 404);
    }

    const formData = await c.req.formData();
    const file = formData.get("file");
    const prompt = formData.get("prompt") || "AI Rendered Image";

    if (!(file instanceof File)) {
      return c.json({ error: "file is required" }, 400);
    }

    const credentials = await resolveCloudflareImagesCredentials(c.env);
    if (!credentials.accountId || credentials.apiTokens.length === 0) {
      return c.json({ error: "Cloudflare credentials not configured" }, 500);
    }

    const processor = new ImageProcessorService(
      c.env,
      credentials.accountId,
      credentials.apiTokens[0],
      {
        fallbackApiTokens: credentials.apiTokens.slice(1),
      },
    );

    const arrayBuffer = await file.arrayBuffer();
    const imageBlob = new Blob([arrayBuffer], { type: file.type || "image/jpeg" });
    const imageId = crypto.randomUUID();

    const uploadResponse = await processor.uploadToCloudflareImages(
      imageBlob,
      imageId,
      file.name || "ai-render.jpg"
    );

    if (!uploadResponse.success) {
      return c.json({ error: "Failed to upload image to Cloudflare" }, 500);
    }

    const deliveryUrl = processor.getDeliveryUrl(uploadResponse, uploadResponse.result.id);
    const deliveryToken = ImageProcessorService.extractDeliveryTokenFromUrl(deliveryUrl) || `${credentials.accountId}/${uploadResponse.result.id}`;

    // Store in aiEdits table
    const edit = await db
      .insert(aiEdits)
      .values({
        originalListingId: photoId,
        prompt: typeof prompt === "string" ? prompt : "AI Rendered Image",
        generatedCfImageId: deliveryToken,
      })
      .returning()
      .get();

    return c.json({
      success: true,
      edit: {
        ...edit,
        path: deliveryUrl,
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to upload AI render",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * GET /api/listing-photos/:id/edits
 * Get all AI edits for a listing photo
 */
listingPhotosRouter.get("/:id/edits", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photoId = parseInt(c.req.param("id"));

    const edits = await db
      .select()
      .from(aiEdits)
      .where(eq(aiEdits.originalListingId, photoId))
      .all();

    const formattedEdits = edits.map((edit) => {
      const deliveryId = edit.generatedCfImageId;
      const path = deliveryId.includes("/")
        ? `https://imagedelivery.net/${deliveryId}/public`
        : `https://imagedelivery.net/${deliveryId}/public`;
      return {
        ...edit,
        path,
      };
    });

    return c.json({
      success: true,
      count: formattedEdits.length,
      edits: formattedEdits,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to get AI edits",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * DELETE /api/listing-photos/:id
 * Delete a listing photo
 */
listingPhotosRouter.delete("/:id", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photoId = parseInt(c.req.param("id"));

    // Check if exists
    const existing = await db
      .select()
      .from(listingPhotos)
      .where(eq(listingPhotos.id, photoId))
      .get();

    if (!existing) {
      return c.json({ error: "Listing photo not found" }, 404);
    }

    // Delete (cascade will handle aiEdits)
    await db.delete(listingPhotos).where(eq(listingPhotos.id, photoId)).run();

    return c.json({
      success: true,
      message: "Listing photo deleted successfully",
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to delete listing photo",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * POST /api/listing-photos/:id/blank-canvas
 * Upload a blank canvas (furniture-removed) image for a listing photo
 */
listingPhotosRouter.post("/:id/blank-canvas", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photoId = parseInt(c.req.param("id"));

    const listingPhoto = await db
      .select()
      .from(listingPhotos)
      .where(eq(listingPhotos.id, photoId))
      .get();

    if (!listingPhoto) {
      return c.json({ error: "Listing photo not found" }, 404);
    }

    const formData = await c.req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return c.json({ error: "file is required" }, 400);
    }

    const credentials = await resolveCloudflareImagesCredentials(c.env);
    if (!credentials.accountId || credentials.apiTokens.length === 0) {
      return c.json({ error: "Cloudflare credentials not configured" }, 500);
    }

    const processor = new ImageProcessorService(
      c.env,
      credentials.accountId,
      credentials.apiTokens[0],
      {
        fallbackApiTokens: credentials.apiTokens.slice(1),
      },
    );

    console.log(`[POST /:id/blank-canvas] Preparing file upload. Name: ${file.name}, Size: ${file.size} bytes, Type: ${file.type}`);
    const arrayBuffer = await file.arrayBuffer();
    const imageBlob = new Blob([arrayBuffer], { type: file.type || "image/jpeg" });
    const imageId = crypto.randomUUID();
    console.log(`[POST /:id/blank-canvas] Created Blob. Size: ${imageBlob.size} bytes. Random UUID imageId: ${imageId}`);

    let uploadResponse;
    try {
      uploadResponse = await processor.uploadToCloudflareImages(
        imageBlob,
        imageId,
        file.name || "blank-canvas.jpg",
      );
      console.log(`[POST /:id/blank-canvas] Cloudflare Images API upload success status:`, uploadResponse.success);
    } catch (uploadErr: any) {
      console.error(`[POST /:id/blank-canvas] uploadToCloudflareImages threw an exception:`, uploadErr.stack || uploadErr.message || uploadErr);
      return c.json({ error: `Upload exception: ${uploadErr.message || uploadErr}` }, 500);
    }

    if (!uploadResponse.success) {
      console.error(`[POST /:id/blank-canvas] Cloudflare Images upload returned success=false:`, JSON.stringify(uploadResponse));
      return c.json({ error: "Failed to upload image to Cloudflare", details: JSON.stringify(uploadResponse) }, 500);
    }

    const deliveryUrl = processor.getDeliveryUrl(uploadResponse, uploadResponse.result.id);
    const deliveryToken =
      ImageProcessorService.extractDeliveryTokenFromUrl(deliveryUrl) ||
      `${credentials.accountId}/${uploadResponse.result.id}`;

    await db.batch([
      db.update(listingPhotos)
        .set({ blankCanvasCfImageId: deliveryToken })
        .where(eq(listingPhotos.id, photoId)),
      db.insert(listingPhotoBlankCanvases)
        .values({
          listingPhotoId: photoId,
          cfImageId: deliveryToken,
          prompt: "Manual Upload",
        }),
    ]);

    return c.json({
      success: true,
      blankCanvasCfImageId: deliveryToken,
      deliveryUrl: `https://imagedelivery.net/${deliveryToken}/public`,
    });
  } catch (error: any) {
    console.error(`[POST /:id/blank-canvas] Critical failure in route handler:`, error.stack || error.message || error);
    return c.json(
      {
        error: "Failed to upload blank canvas",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * DELETE /api/listing-photos/:id/blank-canvas
 * Remove the blank canvas image from a listing photo
 */
listingPhotosRouter.delete("/:id/blank-canvas", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photoId = parseInt(c.req.param("id"));

    const listingPhoto = await db
      .select()
      .from(listingPhotos)
      .where(eq(listingPhotos.id, photoId))
      .get();

    if (!listingPhoto) {
      return c.json({ error: "Listing photo not found" }, 404);
    }

    if (!listingPhoto.blankCanvasCfImageId) {
      return c.json({ error: "No blank canvas to remove" }, 400);
    }

    await db
      .update(listingPhotos)
      .set({ blankCanvasCfImageId: null })
      .where(eq(listingPhotos.id, photoId))
      .run();

    return c.json({
      success: true,
      message: "Blank canvas removed",
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to remove blank canvas",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// In-memory job tracker for blank-canvas generation (admin-only, single worker)
// ---------------------------------------------------------------------------

interface BlankCanvasJobItem {
  listingPhotoId: number;
  status: "pending" | "processing" | "done" | "failed";
  error?: string;
  blankCanvasCfImageId?: string;
}

interface BlankCanvasJob {
  id: string;
  items: BlankCanvasJobItem[];
  startedAt: number;
}

const blankCanvasJobs = new Map<string, BlankCanvasJob>();

/**
 * GET /api/listing-photos/download-script
 * Generate a Python script with CF Images URLs pre-filled for bulk download.
 * Query: ?ids=1,2,3 — comma-separated listing photo IDs to include
 */
listingPhotosRouter.get("/download-script", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const idsParam = c.req.query("ids");

    let photos;
    if (idsParam) {
      const ids = idsParam
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter(Number.isFinite);
      if (ids.length === 0) {
        return c.json({ error: "No valid IDs provided" }, 400);
      }
      photos = await db
        .select()
        .from(listingPhotos)
        .where(inArray(listingPhotos.id, ids))
        .all();
    } else {
      // Default: all listing photos without a blank canvas, excluding skipped ones
      photos = await db
        .select()
        .from(listingPhotos)
        .where(
          and(
            isNull(listingPhotos.blankCanvasCfImageId),
            eq(listingPhotos.skipBlankCanvas, false),
          ),
        )
        .all();
    }

    if (photos.length === 0) {
      return c.json({ error: "No listing photos found for the given criteria" }, 404);
    }

    // Build a list of download entries for the Bash script
    const entries = photos.map((p) => {
      const sanitizedRoomName = (p.roomName || "room").replace(/[^a-zA-Z0-9_-]/g, "_");
      return {
        cfImageId: p.cfImageId,
        filename: `${sanitizedRoomName}_${p.id}`,
      };
    });

    const script = `#!/bin/bash
# Blank Canvas — Bulk Download Script (Bash)
# Generated: ${new Date().toISOString()}

# Define the target directory
DOWNLOAD_DIR="$HOME/Downloads/core-remodel-image-edits-offline"

# Ensure the Downloads directory exists
mkdir -p "$DOWNLOAD_DIR"

# Loop through the list of IDs and Filenames
while read -r cf_id filename; do
    # Skip empty lines
    [[ -z "$cf_id" ]] && continue
    
    url="https://imagedelivery.net/$cf_id/public"
    output_path="$DOWNLOAD_DIR/$filename.jpg"
    
    echo "Downloading: $filename.jpg"
    
    # -sS hides the progress bar but shows errors, -o specifies output file
    curl -sS "$url" -o "$output_path"
done << 'EOF'
${entries.map((e) => `${e.cfImageId} ${e.filename}`).join("\n")}
EOF

echo "Success! All images have been downloaded to $DOWNLOAD_DIR"
`;

    return c.text(script, 200, {
      "Content-Type": "text/x-shellscript",
      "Content-Disposition": `attachment; filename="download_listing_photos.sh"`,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to generate download script",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * POST /api/listing-photos/generate-blank-canvases
 * Start AI-powered blank canvas generation for selected listing photos.
 * Body: { listingPhotoIds: number[] }
 * Returns a jobId for progress tracking.
 */
listingPhotosRouter.post("/generate-blank-canvases", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const body = await c.req.json();
    const { listingPhotoIds, leaveOutline = false } = body as {
      listingPhotoIds?: number[];
      leaveOutline?: boolean;
    };

    if (!Array.isArray(listingPhotoIds) || listingPhotoIds.length === 0) {
      return c.json({ error: "listingPhotoIds array is required" }, 400);
    }

    // Cap at a reasonable batch size to avoid runaway costs
    if (listingPhotoIds.length > 20) {
      return c.json(
        { error: "Maximum 20 photos per generation batch. Select fewer photos." },
        400,
      );
    }

    // Validate all IDs exist and are not excluded
    const photos = await db
      .select()
      .from(listingPhotos)
      .where(
        and(
          inArray(listingPhotos.id, listingPhotoIds),
          eq(listingPhotos.skipBlankCanvas, false),
        ),
      )
      .all();

    if (photos.length === 0) {
      return c.json({ error: "No valid listing photos found" }, 404);
    }

    // Create job
    const jobId = crypto.randomUUID();
    const job: BlankCanvasJob = {
      id: jobId,
      items: photos.map((p) => ({
        listingPhotoId: p.id,
        status: "pending" as const,
      })),
      startedAt: Date.now(),
    };
    blankCanvasJobs.set(jobId, job);

    // Process in the background (non-blocking)
    const credentials = await resolveCloudflareImagesCredentials(c.env);
    if (!credentials.accountId || credentials.apiTokens.length === 0) {
      return c.json({ error: "Cloudflare credentials not configured" }, 500);
    }

    const processor = new ImageProcessorService(
      c.env,
      credentials.accountId,
      credentials.apiTokens[0],
      { fallbackApiTokens: credentials.apiTokens.slice(1) },
    );

    // Fire-and-forget: process each photo sequentially
    c.executionCtx.waitUntil(
      (async () => {
        for (const item of job.items) {
          item.status = "processing";

          try {
            const photo = photos.find((p) => p.id === item.listingPhotoId);
            if (!photo) {
              item.status = "failed";
              item.error = "Photo record not found";
              continue;
            }

            // Build the source image URL
            const cfImageId = photo.cfImageId;
            const sourceUrl = cfImageId.startsWith("http")
              ? cfImageId
              : `https://imagedelivery.net/${cfImageId}/public`;

            // Generate blank canvas via Gemini
            const result = await generateBlankCanvas(sourceUrl, c.env, { leaveOutline });

            // Upload the result to Cloudflare Images
            const imageBlob = new Blob([result.imageBytes], { type: result.mimeType });
            const imageId = crypto.randomUUID();
            const uploadResponse = await processor.uploadToCloudflareImages(
              imageBlob,
              imageId,
              `blank-canvas-${item.listingPhotoId}.${result.mimeType.includes("png") ? "png" : "jpg"}`,
            );

            if (!uploadResponse.success) {
              item.status = "failed";
              item.error = "Failed to upload generated image to Cloudflare";
              continue;
            }

            const deliveryUrl = processor.getDeliveryUrl(uploadResponse, uploadResponse.result.id);
            const deliveryToken =
              ImageProcessorService.extractDeliveryTokenFromUrl(deliveryUrl) ||
              `${credentials.accountId}/${uploadResponse.result.id}`;

            // Update the listing photo with the blank canvas
            await db.batch([
              db.update(listingPhotos)
                .set({ blankCanvasCfImageId: deliveryToken })
                .where(eq(listingPhotos.id, item.listingPhotoId)),
              db.insert(listingPhotoBlankCanvases)
                .values({
                  listingPhotoId: item.listingPhotoId,
                  cfImageId: deliveryToken,
                  prompt: "AI Generate (Batch)",
                })
            ]);

            item.status = "done";
            item.blankCanvasCfImageId = deliveryToken;
          } catch (err) {
            item.status = "failed";
            item.error = err instanceof Error ? err.message : "Unknown error";
            console.error(
              `[BlankCanvas] Failed to generate for listing photo ${item.listingPhotoId}:`,
              err,
            );
          }

          // Small delay between generations to respect rate limits
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        // Clean up old jobs after 30 minutes
        setTimeout(() => {
          blankCanvasJobs.delete(jobId);
        }, 30 * 60 * 1000);
      })(),
    );

    return c.json({
      success: true,
      jobId,
      totalPhotos: photos.length,
      message: `Generation started for ${photos.length} photo(s). Poll /generation-status/${jobId} for progress.`,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to start blank canvas generation",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * GET /api/listing-photos/generation-status/:jobId
 * Check the progress of a blank canvas generation job.
 */
listingPhotosRouter.get("/generation-status/:jobId", async (c) => {
  const jobId = c.req.param("jobId");
  const job = blankCanvasJobs.get(jobId);

  if (!job) {
    return c.json({ error: "Job not found or expired" }, 404);
  }

  const done = job.items.filter((i) => i.status === "done").length;
  const failed = job.items.filter((i) => i.status === "failed").length;
  const processing = job.items.filter((i) => i.status === "processing").length;
  const pending = job.items.filter((i) => i.status === "pending").length;

  return c.json({
    success: true,
    jobId: job.id,
    startedAt: job.startedAt,
    summary: { total: job.items.length, done, failed, processing, pending },
    isComplete: pending === 0 && processing === 0,
    items: job.items,
  });
});

/**
 * POST /api/listing-photos/bulk-skip-blank-canvas
 * Bulk update the skipBlankCanvas flag for listing photos.
 */
listingPhotosRouter.post("/bulk-skip-blank-canvas", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const body = await c.req.json<{ ids: number[]; skip: boolean }>();
    const { ids, skip } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return c.json({ error: "ids array is required" }, 400);
    }

    await db
      .update(listingPhotos)
      .set({ skipBlankCanvas: skip })
      .where(inArray(listingPhotos.id, ids))
      .run();

    return c.json({
      success: true,
      updatedCount: ids.length,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to bulk update skip status",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * GET /api/listing-photos/default-prompt
 * Get the default system prompt used for blank canvas generation.
 */
listingPhotosRouter.get("/default-prompt", async (c) => {
  const leaveOutline = c.req.query("leaveOutline") === "true";
  const hasWindows = c.req.query("hasWindows") !== "false"; // default to true
  const hasSkylights = c.req.query("hasSkylights") === "true"; // default to false
  const hasMask = c.req.query("hasMask") === "true";

  let prompt = buildBlankCanvasPrompt({ leaveOutline, hasWindows, hasSkylights });
  if (hasMask) {
    prompt = `Using the provided image, change only the room contents (removing all furniture, appliances, fixtures, decor, rugs, plants, curtains, window treatments, and personal items) and the specific elements highlighted in the black-and-white annotation mask (which highlights cabinetry, ceiling lights, or items to be removed) to empty/vacant space. Keep everything else in the image exactly the same, preserving the original style, lighting, and composition.

Detail instructions:
${prompt}`;
  }
  return c.json({ success: true, prompt });
});

/**
 * POST /api/listing-photos/refine-blank-canvas
 * Synchronous refinement of a blank canvas image with prompt and/or mask.
 */
listingPhotosRouter.post("/refine-blank-canvas", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const body = await c.req.json();
    const {
      listingPhotoId,
      baseImageUrl,
      maskBase64,
      prompt,
      leaveOutline = false
    } = body as {
      listingPhotoId: number;
      baseImageUrl: string;
      maskBase64?: string;
      prompt?: string;
      leaveOutline?: boolean;
    };

    if (!listingPhotoId || !baseImageUrl) {
      return c.json({ error: "listingPhotoId and baseImageUrl are required" }, 400);
    }

    const credentials = await resolveCloudflareImagesCredentials(c.env);
    if (!credentials.accountId || credentials.apiTokens.length === 0) {
      return c.json({ error: "Cloudflare credentials not configured" }, 500);
    }

    const processor = new ImageProcessorService(
      c.env,
      credentials.accountId,
      credentials.apiTokens[0],
      { fallbackApiTokens: credentials.apiTokens.slice(1) },
    );

    // If maskBase64 is passed, strip any data:image/png;base64, prefix
    let rawMask: string | undefined = undefined;
    if (maskBase64) {
      const match = maskBase64.match(/^data:image\/[a-z]+;base64,(.+)$/i);
      rawMask = match ? match[1] : maskBase64;
    }

    // Call generateBlankCanvas with the specified options
    const result = await generateBlankCanvas(baseImageUrl, c.env, {
      maskBase64: rawMask,
      promptOverride: prompt,
      leaveOutline,
    });

    // Upload to Cloudflare Images
    const imageBlob = new Blob([result.imageBytes], { type: result.mimeType });
    const imageId = crypto.randomUUID();
    const uploadResponse = await processor.uploadToCloudflareImages(
      imageBlob,
      imageId,
      `refined-canvas-${listingPhotoId}-${Date.now()}.${result.mimeType.includes("png") ? "png" : "jpg"}`,
    );

    if (!uploadResponse.success) {
      return c.json({ error: "Failed to upload refined image to Cloudflare" }, 500);
    }

    const deliveryUrl = processor.getDeliveryUrl(uploadResponse, uploadResponse.result.id);
    const deliveryToken =
      ImageProcessorService.extractDeliveryTokenFromUrl(deliveryUrl) ||
      `${credentials.accountId}/${uploadResponse.result.id}`;

    return c.json({
      success: true,
      blankCanvasCfImageId: deliveryToken,
      deliveryUrl: `https://imagedelivery.net/${deliveryToken}/public`,
      thoughts: result.thoughts,
    });
  } catch (error) {
    console.error("Refine blank canvas error:", error);
    const thoughts = (error as any).thoughts || undefined;
    return c.json(
      {
        error: "Failed to refine blank canvas",
        details: error instanceof Error ? error.message : "Unknown error",
        thoughts,
      },
      500,
    );
  }
});

/**
 * POST /api/listing-photos/:id/accept-blank-canvas
 * Accepts an already uploaded blank canvas by pairing its Cloudflare delivery token.
 */
listingPhotosRouter.post("/:id/accept-blank-canvas", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photoId = parseInt(c.req.param("id"));
    const { blankCanvasCfImageId, prompt } = await c.req.json<{
      blankCanvasCfImageId: string;
      prompt?: string;
    }>();

    if (!blankCanvasCfImageId) {
      return c.json({ error: "blankCanvasCfImageId is required" }, 400);
    }

    const listingPhoto = await db
      .select()
      .from(listingPhotos)
      .where(eq(listingPhotos.id, photoId))
      .get();

    if (!listingPhoto) {
      return c.json({ error: "Listing photo not found" }, 404);
    }

    await db.batch([
      db.update(listingPhotos)
        .set({ blankCanvasCfImageId })
        .where(eq(listingPhotos.id, photoId)),
      db.insert(listingPhotoBlankCanvases)
        .values({
          listingPhotoId: photoId,
          cfImageId: blankCanvasCfImageId,
          prompt: prompt || "Accepted Refinement",
        })
    ]);

    return c.json({
      success: true,
      blankCanvasCfImageId,
      deliveryUrl: `https://imagedelivery.net/${blankCanvasCfImageId}/public`,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to accept blank canvas",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * GET /api/listing-photos/:id/blank-canvases
 * Retrieve all blank canvases associated with a listing photo.
 */
listingPhotosRouter.get("/:id/blank-canvases", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photoId = parseInt(c.req.param("id"));

    const photo = await db
      .select()
      .from(listingPhotos)
      .where(eq(listingPhotos.id, photoId))
      .get();

    if (!photo) {
      return c.json({ error: "Listing photo not found" }, 404);
    }

    const canvases = await db
      .select()
      .from(listingPhotoBlankCanvases)
      .where(eq(listingPhotoBlankCanvases.listingPhotoId, photoId))
      .orderBy(desc(listingPhotoBlankCanvases.datetimeCreated))
      .all();

    // Enforce that the listing photo's current blankCanvasCfImageId is included in the list
    const hasPrimary = photo.blankCanvasCfImageId;
    const primaryInList = canvases.find((canv: any) => canv.cfImageId === hasPrimary);

    const list = [...canvases];
    if (hasPrimary && !primaryInList) {
      list.unshift({
        id: -1, // Dummy ID representing primary
        listingPhotoId: photoId,
        cfImageId: hasPrimary,
        prompt: "Legacy / Primary Blank Canvas",
        datetimeCreated: photo.datetimeCreated || new Date(),
      });
    }

    return c.json({
      success: true,
      canvases: list,
      primaryCfImageId: hasPrimary,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load blank canvases",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * DELETE /api/listing-photos/:id/blank-canvases/:canvasId
 * Delete a specific blank canvas.
 */
listingPhotosRouter.delete("/:id/blank-canvases/:canvasId", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photoId = parseInt(c.req.param("id"));
    const canvasIdStr = c.req.param("canvasId");
    const canvasId = parseInt(canvasIdStr);

    const photo = await db
      .select()
      .from(listingPhotos)
      .where(eq(listingPhotos.id, photoId))
      .get();

    if (!photo) {
      return c.json({ error: "Listing photo not found" }, 404);
    }

    let deletedCfImageId: string | null = null;

    if (Number.isNaN(canvasId) || canvasId === -1) {
      // Deleting the legacy/primary reference itself
      deletedCfImageId = photo.blankCanvasCfImageId;
      await db
        .update(listingPhotos)
        .set({ blankCanvasCfImageId: null })
        .where(eq(listingPhotos.id, photoId))
        .run();
    } else {
      const record = await db
        .select()
        .from(listingPhotoBlankCanvases)
        .where(eq(listingPhotoBlankCanvases.id, canvasId))
        .get();

      if (record) {
        deletedCfImageId = record.cfImageId;
        await db
          .delete(listingPhotoBlankCanvases)
          .where(eq(listingPhotoBlankCanvases.id, canvasId))
          .run();
      }
    }

    // If we deleted the active primary canvas, update the listingPhoto's primary pointer to the next newest canvas
    if (deletedCfImageId && photo.blankCanvasCfImageId === deletedCfImageId) {
      const nextNewest = await db
        .select()
        .from(listingPhotoBlankCanvases)
        .where(eq(listingPhotoBlankCanvases.listingPhotoId, photoId))
        .orderBy(desc(listingPhotoBlankCanvases.datetimeCreated))
        .limit(1)
        .get();

      await db
        .update(listingPhotos)
        .set({ blankCanvasCfImageId: nextNewest ? nextNewest.cfImageId : null })
        .where(eq(listingPhotos.id, photoId))
        .run();
    }

    return c.json({ success: true });
  } catch (error) {
    return c.json(
      {
        error: "Failed to delete blank canvas",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * POST /api/listing-photos/:id/set-primary-blank-canvas
 * Make a specific blank canvas primary.
 */
listingPhotosRouter.post("/:id/set-primary-blank-canvas", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const photoId = parseInt(c.req.param("id"));
    const { cfImageId } = await c.req.json<{ cfImageId: string }>();

    if (!cfImageId) {
      return c.json({ error: "cfImageId is required" }, 400);
    }

    await db
      .update(listingPhotos)
      .set({ blankCanvasCfImageId: cfImageId })
      .where(eq(listingPhotos.id, photoId))
      .run();

    return c.json({ success: true });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update primary blank canvas",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { listingPhotosRouter };
