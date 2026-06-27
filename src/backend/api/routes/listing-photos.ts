/**
 * @fileoverview Listing Photos API routes
 */

import { aiEdits, images, listingPhotos, rooms } from "@backend/db";
import { ensureHomeCatalogSeed } from "@backend/services/home-catalog";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import { ImageProcessorService } from "../../services/image-processor";
import { generateBlankCanvas } from "../../services/render/blank-canvas-generator";

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

    const arrayBuffer = await file.arrayBuffer();
    const imageBlob = new Blob([arrayBuffer], { type: file.type || "image/jpeg" });
    const imageId = crypto.randomUUID();

    const uploadResponse = await processor.uploadToCloudflareImages(
      imageBlob,
      imageId,
      file.name || "blank-canvas.jpg",
    );

    if (!uploadResponse.success) {
      return c.json({ error: "Failed to upload image to Cloudflare" }, 500);
    }

    const deliveryUrl = processor.getDeliveryUrl(uploadResponse, uploadResponse.result.id);
    const deliveryToken =
      ImageProcessorService.extractDeliveryTokenFromUrl(deliveryUrl) ||
      `${credentials.accountId}/${uploadResponse.result.id}`;

    await db
      .update(listingPhotos)
      .set({ blankCanvasCfImageId: deliveryToken })
      .where(eq(listingPhotos.id, photoId))
      .run();

    return c.json({
      success: true,
      blankCanvasCfImageId: deliveryToken,
      deliveryUrl: `https://imagedelivery.net/${deliveryToken}/public`,
    });
  } catch (error) {
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
      // Default: all listing photos without a blank canvas
      photos = await db
        .select()
        .from(listingPhotos)
        .where(isNull(listingPhotos.blankCanvasCfImageId))
        .all();
    }

    if (photos.length === 0) {
      return c.json({ error: "No listing photos found for the given criteria" }, 404);
    }

    // Build a list of download entries for the Python script
    const entries = photos.map((p) => ({
      id: p.id,
      cfImageId: p.cfImageId,
      roomName: p.roomName || "Unassigned",
      filename: `${(p.roomName || "room").replace(/[^a-zA-Z0-9_-]/g, "_")}_${p.id}`,
    }));

    const script = `#!/usr/bin/env python3
"""
Blank Canvas — Bulk Download Script
Generated: ${new Date().toISOString()}

Downloads ${entries.length} listing photo(s) from Cloudflare Images.
After downloading, edit each image to remove all furniture/fixtures/decor,
then re-upload the blank canvas versions through the admin UI.

Usage:
  1. Set your Cloudflare API token below (or as env var)
  2. Run: python3 download_listing_photos.py
  3. Photos will be saved to ./listing_photos/
"""

import os
import sys

try:
    import requests
except ImportError:
    print("Installing requests...")
    os.system(f"{sys.executable} -m pip install requests")
    import requests

# ──────────────────────────────────────────────────────────────────
# CONFIGURATION — Set your Cloudflare API token here or via env var
# ──────────────────────────────────────────────────────────────────
CF_API_TOKEN = os.environ.get("CF_API_TOKEN", "YOUR_CLOUDFLARE_API_TOKEN_HERE")

# ──────────────────────────────────────────────────────────────────
# Photo manifest (auto-generated from your listing photos database)
# ──────────────────────────────────────────────────────────────────
PHOTOS = [
${entries
  .map(
    (e) =>
      `    {"id": ${e.id}, "cf_image_id": "${e.cfImageId}", "room": "${e.roomName}", "filename": "${e.filename}"},`,
  )
  .join("\n")}
]

# ──────────────────────────────────────────────────────────────────
# Download logic
# ──────────────────────────────────────────────────────────────────
OUTPUT_DIR = "listing_photos"
os.makedirs(OUTPUT_DIR, exist_ok=True)

def download_photo(photo):
    """Download a single photo from Cloudflare Images delivery URL."""
    cf_image_id = photo["cf_image_id"]
    filename = photo["filename"]
    
    # Try delivery URL first (public, no auth needed)
    delivery_url = f"https://imagedelivery.net/{cf_image_id}/public"
    
    try:
        resp = requests.get(delivery_url, timeout=30)
        if resp.status_code == 200:
            ext = "jpg"
            content_type = resp.headers.get("content-type", "")
            if "png" in content_type:
                ext = "png"
            elif "webp" in content_type:
                ext = "webp"
            
            filepath = os.path.join(OUTPUT_DIR, f"{filename}.{ext}")
            with open(filepath, "wb") as f:
                f.write(resp.content)
            print(f"  ✓ {filename}.{ext} ({len(resp.content) / 1024:.0f} KB)")
            return True
        else:
            print(f"  ✗ {filename} — HTTP {resp.status_code}")
            return False
    except Exception as e:
        print(f"  ✗ {filename} — {e}")
        return False

if __name__ == "__main__":
    if CF_API_TOKEN == "YOUR_CLOUDFLARE_API_TOKEN_HERE":
        print("⚠️  Note: Using public delivery URLs (no API token set).")
        print("   If downloads fail, set CF_API_TOKEN in this script or as env var.")
        print()
    
    print(f"Downloading {len(PHOTOS)} listing photos to ./{OUTPUT_DIR}/")
    print("=" * 60)
    
    success = 0
    failed = 0
    for photo in PHOTOS:
        if download_photo(photo):
            success += 1
        else:
            failed += 1
    
    print()
    print(f"Done! {success} downloaded, {failed} failed.")
    print(f"Photos saved to: {os.path.abspath(OUTPUT_DIR)}/")
    print()
    print("NEXT STEPS:")
    print("1. Open each photo in your AI editor (e.g., Photoshop Generative Fill, DALL-E)")
    print("2. Remove all furniture, fixtures, decor — leave the room completely empty")
    print("3. Save the edited versions with the SAME filenames")
    print("4. Re-upload through the Blank Canvas admin UI")
`;

    return c.text(script, 200, {
      "Content-Type": "text/x-python",
      "Content-Disposition": `attachment; filename="download_listing_photos.py"`,
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
    const { listingPhotoIds } = body as { listingPhotoIds?: number[] };

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

    // Validate all IDs exist
    const photos = await db
      .select()
      .from(listingPhotos)
      .where(inArray(listingPhotos.id, listingPhotoIds))
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
            const result = await generateBlankCanvas(sourceUrl, c.env);

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
            await db
              .update(listingPhotos)
              .set({ blankCanvasCfImageId: deliveryToken })
              .where(eq(listingPhotos.id, item.listingPhotoId))
              .run();

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

export { listingPhotosRouter };
