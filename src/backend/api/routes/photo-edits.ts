/**
 * @fileoverview Session-based in-photo editing routes
 *
 * Tracks iterative edit sessions + revisions, and persists generated uploads
 * to Cloudflare Images and D1.
 *
 * Uses Gemini 3 Pro via Cloudflare AI Gateway for all image generation.
 */

import {
  imageEditRevisions,
  imageEditSessions,
  images,
  listingPhotos,
} from "@backend/db";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";
import { zValidator } from "@hono/zod-validator";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

import { ImageProcessorService, processImageEdit } from "../../services/image-processor";

const photoEditsRouter = new Hono<{ Bindings: Env }>();

type ImageCategory = "listing" | "inspirational" | "ai_render";

interface ImageMetadata {
  note?: string;
  tags?: string[];
  decision?: {
    promoted?: boolean;
    label?: string;
    stage?: "draft" | "candidate" | "final";
  };
  camera?: {
    floor?: number;
    x?: number;
    y?: number;
    direction?: number;
    label?: string;
  };
}

interface CloudflareImagesUploadResponse {
  success: boolean;
  result?: {
    id?: string;
    variants?: string[];
  };
}

function extractDeliveryTokenFromUrl(deliveryUrl: string): string | null {
  const parts = deliveryUrl.split("/").filter(Boolean);
  if (parts.length < 4) {
    return null;
  }
  return `${parts[2]}/${parts[3]}`;
}

function resolveImageUrl(image: typeof images.$inferSelect): string {
  const deliveryId = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!deliveryId) {
    return "";
  }
  if (deliveryId.startsWith("http://") || deliveryId.startsWith("https://")) {
    return deliveryId;
  }
  if (deliveryId.includes("/")) {
    return `https://imagedelivery.net/${deliveryId}/public`;
  }
  return `https://imagedelivery.net/${deliveryId}/public`;
}

/**
 * Resolve the listingPhoto record for a given image ID (if it has one).
 * Returns the listing photo with blankCanvasCfImageId, roomName, etc.
 */
async function resolveListingPhotoForImage(
  db: ReturnType<typeof drizzle>,
  imageId: string,
): Promise<typeof listingPhotos.$inferSelect | null> {
  const row = await db
    .select()
    .from(listingPhotos)
    .where(eq(listingPhotos.imageId, imageId))
    .get();
  return row ?? null;
}

async function toImageBytes(payload: unknown): Promise<Uint8Array> {
  if (payload instanceof ReadableStream || payload instanceof ArrayBuffer) {
    const buffer = await new Response(payload as BodyInit).arrayBuffer();
    return new Uint8Array(buffer);
  }

  if (payload && typeof payload === "object" && "image" in payload) {
    const imageData = (payload as { image?: unknown }).image;

    if (typeof imageData === "string") {
      const binary = atob(imageData);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }

    if (Array.isArray(imageData)) {
      return Uint8Array.from(imageData as number[]);
    }
  }

  throw new Error("Unsupported Workers AI image output format");
}

function parseImageMetadata(raw: string | null | undefined): ImageMetadata {
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw) as ImageMetadata;
  } catch {
    return {};
  }
}

function normalizeImageCategory(image: typeof images.$inferSelect): ImageCategory {
  if (
    image.photoCategory === "listing" ||
    image.photoCategory === "inspirational" ||
    image.photoCategory === "ai_render"
  ) {
    return image.photoCategory;
  }
  return image.isListingPhoto ? "listing" : "inspirational";
}

photoEditsRouter.post(
  "/",
  zValidator(
    "json",
    z.object({
      sessionId: z.string(),
      parentId: z.string().nullable(),
      prompt: z.string(),
      startingImageUrl: z.string().url(),
      images: z
        .array(
          z.object({
            data: z.string(), // raw base64 string
            mimeType: z.string(),
          }),
        )
        .min(1)
        .max(14), // Gemini 3 Pro supports up to 14 reference images
    }),
  ),
  async (c) => {
    const env = c.env;
    const db = drizzle(env.DB);
    const body = c.req.valid("json");

    // 1. Process image with Gemini 3 Pro via AI Gateway
    const editedImageBase64 = await processImageEdit(env, body.prompt, body.images);

    if (!editedImageBase64) {
      return c.json({ error: "Failed to generate image via Gemini 3 Pro." }, 500);
    }

    const accountId = await env.CLOUDFLARE_ACCOUNT_ID.get();
    const cfImagesToken = await env.CF_IMAGES_TOKEN.get();

    if (!accountId || !cfImagesToken) {
      return c.json(
        {
          error:
            "Cloudflare Images credentials are missing (CLOUDFLARE_ACCOUNT_ID / CF_IMAGES_TOKEN).",
        },
        500,
      );
    }

    // 2. Convert base64 to Blob and Upload directly to Cloudflare Images
    const formData = new FormData();
    const imageBlob = await (await fetch(`data:image/jpeg;base64,${editedImageBase64}`)).blob();
    formData.append("file", imageBlob, "edited-remodel.jpg");

    const cfImagesRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/images/v1`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfImagesToken}`,
        },
        body: formData,
      },
    );

    const cfImagesData = (await cfImagesRes.json()) as CloudflareImagesUploadResponse;

    if (!cfImagesData.success) {
      return c.json({ error: "Failed to persist output to Cloudflare Images." }, 500);
    }

    // Grab the first variant URL provided by Cloudflare Images
    const outputImageUrl = cfImagesData.result?.variants?.[0];
    if (typeof outputImageUrl !== "string" || outputImageUrl.length === 0) {
      return c.json({ error: "Cloudflare Images did not return a variant URL." }, 500);
    }

    // 3. Store the revision branch in D1
    const revisionId = crypto.randomUUID();
    await db
      .insert(imageEditRevisions)
      .values({
        id: revisionId,
        sessionId: body.sessionId,
        parentId: body.parentId,
        prompt: body.prompt,
        startingImageUrl: body.startingImageUrl,
        outputImageUrl,
        metadata: JSON.stringify({
          model: "gemini-3-pro-image-preview",
          inputCount: body.images.length,
        }),
      })
      .run();

    return c.json({
      success: true,
      revisionId,
      outputImageUrl,
    });
  },
);

photoEditsRouter.get("/sessions", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const sessions = await db
      .select()
      .from(imageEditSessions)
      .orderBy(desc(imageEditSessions.datetimeLastModified))
      .all();

    const result = await Promise.all(
      sessions.map(async (session) => {
        const revisions = await db
          .select()
          .from(imageEditRevisions)
          .where(eq(imageEditRevisions.sessionId, session.id))
          .all();

        const sourceImage = session.sourceImageId
          ? await db.select().from(images).where(eq(images.id, session.sourceImageId)).get()
          : null;

        const lastRevision = revisions.reduce(
          (latest, revision) =>
            (revision.revisionNumber ?? 0) > (latest.revisionNumber ?? 0) ? revision : latest,
          { revisionNumber: 0 } as any,
        );

        return {
          ...session,
          revisionCount: revisions.length,
          lastRevisionNumber: lastRevision.revisionNumber || 0,
          sourceImage,
        };
      }),
    );

    return c.json({
      success: true,
      sessions: result,
    });
  } catch (error) {
    console.error("List edit sessions error:", error);
    return c.json(
      {
        error: "Failed to list edit sessions",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

photoEditsRouter.post("/sessions", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const body = (await c.req.json()) as {
      name?: string;
      sourceImageId?: string | null;
    };

    let sourceImageId: string | null = null;
    if (body.sourceImageId) {
      const sourceImage = await db
        .select()
        .from(images)
        .where(eq(images.id, body.sourceImageId))
        .get();
      if (!sourceImage) {
        return c.json({ error: "Source image not found" }, 404);
      }
      sourceImageId = sourceImage.id;
    }

    const id = crypto.randomUUID();
    const fallbackName = `Session ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
    const name = body.name?.trim() || fallbackName;

    await db
      .insert(imageEditSessions)
      .values({
        id,
        name,
        sourceImageId,
      })
      .run();

    const created = await db
      .select()
      .from(imageEditSessions)
      .where(eq(imageEditSessions.id, id))
      .get();

    return c.json({
      success: true,
      session: created,
    });
  } catch (error) {
    console.error("Create edit session error:", error);
    return c.json(
      {
        error: "Failed to create edit session",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

photoEditsRouter.patch("/sessions/:sessionId", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const sessionId = c.req.param("sessionId");
    const body = (await c.req.json()) as {
      name?: string;
      sourceImageId?: string | null;
      status?: string;
    };

    const session = await db
      .select()
      .from(imageEditSessions)
      .where(eq(imageEditSessions.id, sessionId))
      .get();

    if (!session) {
      return c.json({ error: "Edit session not found" }, 404);
    }

    let sourceImageId = session.sourceImageId;
    if (body.sourceImageId !== undefined) {
      if (body.sourceImageId === null || body.sourceImageId.trim() === "") {
        sourceImageId = null;
      } else {
        const sourceImage = await db
          .select()
          .from(images)
          .where(eq(images.id, body.sourceImageId))
          .get();
        if (!sourceImage) {
          return c.json({ error: "Source image not found" }, 404);
        }
        sourceImageId = sourceImage.id;
      }
    }

    const nextStatus =
      typeof body.status === "string" && body.status.trim().length > 0
        ? body.status.trim()
        : session.status;

    const nextName =
      typeof body.name === "string" && body.name.trim().length > 0
        ? body.name.trim()
        : session.name;

    await db
      .update(imageEditSessions)
      .set({
        name: nextName,
        sourceImageId,
        status: nextStatus,
        datetimeLastModified: new Date(),
      })
      .where(eq(imageEditSessions.id, sessionId))
      .run();

    const updated = await db
      .select()
      .from(imageEditSessions)
      .where(eq(imageEditSessions.id, sessionId))
      .get();

    return c.json({
      success: true,
      session: updated,
    });
  } catch (error) {
    console.error("Update edit session error:", error);
    return c.json(
      {
        error: "Failed to update edit session",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

photoEditsRouter.get("/sessions/:sessionId", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const sessionId = c.req.param("sessionId");

    const session = await db
      .select()
      .from(imageEditSessions)
      .where(eq(imageEditSessions.id, sessionId))
      .get();

    if (!session) {
      return c.json({ error: "Edit session not found" }, 404);
    }

    const revisions = await db
      .select()
      .from(imageEditRevisions)
      .where(eq(imageEditRevisions.sessionId, sessionId))
      .all();

    const revisionsSorted = [...revisions].sort(
      (a, b) => (a.revisionNumber ?? 0) - (b.revisionNumber ?? 0),
    );

    const sourceImage = session.sourceImageId
      ? await db.select().from(images).where(eq(images.id, session.sourceImageId)).get()
      : null;

    // Resolve listing photo metadata (blank canvas ID, room name) for the source image
    const sourceListingPhoto = sourceImage
      ? await resolveListingPhotoForImage(db, sourceImage.id)
      : null;

    const outputImageMap = new Map<string, typeof images.$inferSelect>();
    const sourceImageMap = new Map<string, typeof images.$inferSelect>();
    for (const revision of revisionsSorted) {
      if (revision.outputImageId) {
        const outputImage = await db
          .select()
          .from(images)
          .where(eq(images.id, revision.outputImageId))
          .get();
        if (outputImage) {
          outputImageMap.set(revision.outputImageId, outputImage);
        }
      }

      if (revision.sourceImageId) {
        const revisionSourceImg = await db
          .select()
          .from(images)
          .where(eq(images.id, revision.sourceImageId))
          .get();
        if (revisionSourceImg) {
          sourceImageMap.set(revision.sourceImageId, revisionSourceImg);
        }
      }
    }

    return c.json({
      success: true,
      session,
      sourceImage: sourceImage
        ? {
            ...sourceImage,
            listingPhoto: sourceListingPhoto
              ? {
                  id: sourceListingPhoto.id,
                  roomId: sourceListingPhoto.roomId,
                  roomName: sourceListingPhoto.roomName,
                  description: sourceListingPhoto.description,
                  blankCanvasCfImageId: sourceListingPhoto.blankCanvasCfImageId ?? null,
                  skipBlankCanvas: sourceListingPhoto.skipBlankCanvas ?? false,
                }
              : null,
          }
        : null,
      revisions: revisionsSorted.map((revision) => ({
        ...revision,
        sourceImage: revision.sourceImageId
          ? (sourceImageMap.get(revision.sourceImageId) ?? null)
          : null,
        outputImage: revision.outputImageId
          ? outputImageMap.get(revision.outputImageId) ?? null
          : null,
      })),
    });
  } catch (error) {
    console.error("Get edit session error:", error);
    return c.json(
      {
        error: "Failed to get edit session",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

photoEditsRouter.get("/decision-room", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const [allImagesRaw, allSessions, allRevisions] = await Promise.all([
      db.select().from(images).all(),
      db.select().from(imageEditSessions).all(),
      db.select().from(imageEditRevisions).all(),
    ]);

    // Exclude duplicate-flagged and soft-deleted images from the decision room
    const allImages = allImagesRaw.filter((img) => !img.isDuplicate && !img.isDeleted);

    const imagesById = new Map<string, typeof images.$inferSelect>();
    for (const image of allImages) {
      imagesById.set(image.id, image);
    }

    const revisionsBySession = new Map<string, (typeof imageEditRevisions.$inferSelect)[]>();
    for (const revision of allRevisions) {
      if (!revisionsBySession.has(revision.sessionId)) {
        revisionsBySession.set(revision.sessionId, []);
      }
      revisionsBySession.get(revision.sessionId)?.push(revision);
    }

    interface RoomBucket {
      room: string;
      listingImages: (typeof images.$inferSelect)[];
      inspirationalImages: (typeof images.$inferSelect)[];
      aiRenderImages: (typeof images.$inferSelect)[];
      promotedImages: Array<typeof images.$inferSelect & { metadataParsed: ImageMetadata }>;
      cameraPoints: Array<{
        imageId: string;
        floor: number;
        x: number;
        y: number;
        direction: number;
        label: string;
      }>;
      sessions: Array<{
        id: string;
        name: string;
        status: string;
        sourceImageId: string | null;
        datetimeCreated: Date;
        datetimeLastModified: Date;
        revisions: Array<{
          id: string;
          revisionNumber: number;
          prompt: string;
          model: string | null;
          sourceImageId: string | null;
          outputImageId: string;
          sourceImage: typeof images.$inferSelect | null;
          outputImage: typeof images.$inferSelect | null;
          datetimeCreated: Date;
        }>;
      }>;
    }

    const rooms = new Map<string, RoomBucket>();
    const ensureRoom = (roomName: string): RoomBucket => {
      if (!rooms.has(roomName)) {
        rooms.set(roomName, {
          room: roomName,
          listingImages: [],
          inspirationalImages: [],
          aiRenderImages: [],
          promotedImages: [],
          cameraPoints: [],
          sessions: [],
        });
      }
      return rooms.get(roomName)!;
    };

    const floorSet = new Set<number>([1]);

    for (const image of allImages) {
      const room = image.roomType?.trim() || "unassigned";
      const bucket = ensureRoom(room);
      const metadataParsed = parseImageMetadata(image.metadata);
      const category = normalizeImageCategory(image);

      if (category === "listing") {
        bucket.listingImages.push(image);
      } else if (category === "inspirational") {
        bucket.inspirationalImages.push(image);
      } else {
        bucket.aiRenderImages.push(image);
      }

      if (metadataParsed.decision?.promoted) {
        bucket.promotedImages.push({
          ...image,
          metadataParsed,
        });
      }

      const camera = metadataParsed.camera;
      if (camera && typeof camera.x === "number" && typeof camera.y === "number") {
        const floor = typeof camera.floor === "number" ? camera.floor : 1;
        floorSet.add(floor);
        bucket.cameraPoints.push({
          imageId: image.id,
          floor,
          x: camera.x,
          y: camera.y,
          direction: typeof camera.direction === "number" ? camera.direction : 0,
          label: camera.label || `${room} camera`,
        });
      }
    }

    for (const session of allSessions) {
      const revisions = [...(revisionsBySession.get(session.id) || [])].sort(
        (a, b) => (a.revisionNumber ?? 0) - (b.revisionNumber ?? 0),
      );

      const sessionSourceImage = session.sourceImageId
        ? imagesById.get(session.sourceImageId) || null
        : null;
      const lastRevision = revisions.length > 0 ? revisions[revisions.length - 1] : null;
      const lastOutputImage =
        lastRevision && lastRevision.outputImageId
          ? imagesById.get(lastRevision.outputImageId) || null
          : null;

      const room =
        sessionSourceImage?.roomType?.trim() || lastOutputImage?.roomType?.trim() || "unassigned";
      const bucket = ensureRoom(room);

      bucket.sessions.push({
        id: session.id,
        name: session.name,
        status: session.status,
        sourceImageId: session.sourceImageId,
        datetimeCreated: session.datetimeCreated,
        datetimeLastModified: session.datetimeLastModified,
        revisions: revisions.map((revision) => ({
          id: revision.id,
          revisionNumber: revision.revisionNumber ?? 0,
          prompt: revision.prompt,
          model: revision.model,
          sourceImageId: revision.sourceImageId,
          outputImageId: revision.outputImageId ?? "",
          sourceImage: revision.sourceImageId
            ? imagesById.get(revision.sourceImageId) || null
            : null,
          outputImage: revision.outputImageId
            ? imagesById.get(revision.outputImageId) || null
            : null,
          datetimeCreated: revision.datetimeCreated ?? new Date(),
        })),
      });
    }

    const roomPayload = Array.from(rooms.values())
      .sort((a, b) => a.room.localeCompare(b.room))
      .map((room) => ({
        room: room.room,
        listingImages: room.listingImages,
        inspirationalImages: room.inspirationalImages,
        aiRenderImages: room.aiRenderImages,
        promotedImages: room.promotedImages,
        sessions: room.sessions.sort(
          (a, b) =>
            new Date(b.datetimeLastModified).getTime() - new Date(a.datetimeLastModified).getTime(),
        ),
        cameraPoints: room.cameraPoints,
      }));

    return c.json({
      success: true,
      generatedAt: new Date().toISOString(),
      floors: Array.from(floorSet.values()).sort((a, b) => a - b),
      rooms: roomPayload,
    });
  } catch (error) {
    console.error("Decision room data error:", error);
    return c.json(
      {
        error: "Failed to load decision room data",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * Core revision creation logic — shared by single and batch endpoints.
 */
async function createSingleRevision(
  env: Env,
  sessionId: string,
  params: {
    prompt: string;
    sourceImageId: string;
    roomType?: string | null;
    maskBase64?: string | null;
    blankCanvasImageId?: string | null;
    category?: string | null;
    inspoImageIds?: string[];
  },
): Promise<{
  success: boolean;
  error?: string;
  revision?: any;
  outputImage?: any;
  deliveryUrl?: string;
}> {
  const db = drizzle(env.DB);

  const session = await db
    .select()
    .from(imageEditSessions)
    .where(eq(imageEditSessions.id, sessionId))
    .get();

  if (!session) {
    return { success: false, error: "Edit session not found" };
  }

  // Resolve the actual image to feed Gemini — prefer blank canvas when provided
  const actualSourceId = params.blankCanvasImageId || params.sourceImageId;

  const sourceImage = await db
    .select()
    .from(images)
    .where(eq(images.id, actualSourceId))
    .get();

  // Fallback: if blank canvas ID doesn't resolve as an `images` row, treat it
  // as a raw CF Images delivery token and use the original source image row
  // for metadata, but the blank canvas URL for the pixel data.
  let sourceImageRow = sourceImage;
  let blankCanvasUrl: string | null = null;

  if (!sourceImage && params.blankCanvasImageId) {
    sourceImageRow = await db
      .select()
      .from(images)
      .where(eq(images.id, params.sourceImageId))
      .get() ?? undefined;

    if (!sourceImageRow) {
      return { success: false, error: "Source image not found" };
    }

    // blankCanvasImageId is a CF delivery token, not a UUID image row
    const token = params.blankCanvasImageId;
    blankCanvasUrl = token.startsWith("http")
      ? token
      : `https://imagedelivery.net/${token}/public`;
  } else if (!sourceImage) {
    return { success: false, error: "Source image not found" };
  }

  const credentials = await resolveCloudflareImagesCredentials(env);
  if (!credentials.accountId || credentials.apiTokens.length === 0) {
    return { success: false, error: "Cloudflare credentials not configured" };
  }

  // Determine the pixel-source URL
  const sourceUrl = blankCanvasUrl || resolveImageUrl(sourceImageRow!);
  if (!sourceUrl) {
    return { success: false, error: "Source image URL is unavailable" };
  }

  const sourceResponse = await fetch(sourceUrl, { cache: "no-store" });
  if (!sourceResponse.ok) {
    return {
      success: false,
      error: `Failed to fetch source image (${sourceResponse.status})`,
    };
  }

  const sourceBytes = new Uint8Array(await sourceResponse.arrayBuffer());
  const sourceMime = sourceResponse.headers.get("content-type") || "image/jpeg";
  let sourceB64 = "";
  const b64Chunk = 0x8000;
  for (let i = 0; i < sourceBytes.length; i += b64Chunk) {
    sourceB64 += String.fromCharCode(...sourceBytes.subarray(i, i + b64Chunk));
  }
  const base64Images = [{ data: btoa(sourceB64), mimeType: sourceMime }];

  // Append mask if provided
  if (params.maskBase64) {
    const match = params.maskBase64.match(/^data:image\/[a-z]+;base64,(.+)$/i);
    const rawMask = match ? match[1] : params.maskBase64;
    base64Images.push({ data: rawMask, mimeType: "image/png" });
  }

  // Append inspiration images if provided (for stitch category)
  if (params.inspoImageIds && params.inspoImageIds.length > 0) {
    for (const inspoId of params.inspoImageIds.slice(0, 6)) {
      const inspoImage = await db
        .select()
        .from(images)
        .where(eq(images.id, inspoId))
        .get();
      if (!inspoImage) continue;
      const inspoUrl = resolveImageUrl(inspoImage);
      if (!inspoUrl) continue;
      try {
        const inspoResponse = await fetch(inspoUrl, { cache: "no-store" });
        if (!inspoResponse.ok) continue;
        const inspoBytes = new Uint8Array(await inspoResponse.arrayBuffer());
        const inspoMime = inspoResponse.headers.get("content-type") || "image/jpeg";
        let inspoB64 = "";
        for (let j = 0; j < inspoBytes.length; j += b64Chunk) {
          inspoB64 += String.fromCharCode(...inspoBytes.subarray(j, j + b64Chunk));
        }
        base64Images.push({ data: btoa(inspoB64), mimeType: inspoMime });
      } catch {
        // Skip failed inspo fetches
      }
    }
  }

  const editedBase64 = await processImageEdit(env, params.prompt, base64Images);
  if (!editedBase64) {
    return { success: false, error: "Gemini returned no image for this edit." };
  }

  const generatedBlob = await (
    await fetch(`data:image/png;base64,${editedBase64}`)
  ).blob();

  const uploadFile = new File(
    [generatedBlob],
    `render-${sessionId}-${Date.now()}.png`,
    { type: "image/png" },
  );

  const processor = new ImageProcessorService(
    env,
    credentials.accountId,
    credentials.apiTokens[0],
    { fallbackApiTokens: credentials.apiTokens.slice(1) },
  );
  const outputImageId = crypto.randomUUID();
  const uploadResponse = await processor.uploadToCloudflareImages(
    uploadFile,
    outputImageId,
    uploadFile.name,
  );

  if (!uploadResponse.success) {
    return { success: false, error: "Failed to upload generated image" };
  }

  const deliveryUrl = processor.getDeliveryUrl(uploadResponse, outputImageId);
  const deliveryToken =
    extractDeliveryTokenFromUrl(deliveryUrl) ||
    `${credentials.accountId}/${uploadResponse.result.id}`;

  const revisionRows = await db
    .select()
    .from(imageEditRevisions)
    .where(eq(imageEditRevisions.sessionId, sessionId))
    .all();
  const revisionNumber =
    revisionRows.reduce(
      (maxValue, row) => Math.max(maxValue, row.revisionNumber ?? 0),
      0,
    ) + 1;

  const roomType =
    params.roomType?.trim().toLowerCase() ||
    sourceImageRow!.roomType ||
    "unassigned";

  const model = "gemini-3.1-flash-image";

  await db
    .insert(images)
    .values({
      id: outputImageId,
      displayName: `${session.name} · Revision ${revisionNumber}`,
      cfImageIdOriginal: deliveryToken,
      cfImageIdOptimized: null,
      photoCategory: "ai_render",
      roomId: sourceImageRow!.roomId,
      roomType,
      isInstagram: false,
      isListingPhoto: false,
      metadata: JSON.stringify({
        sourceImageId: params.sourceImageId,
        blankCanvasImageId: params.blankCanvasImageId ?? null,
        sessionId,
        revisionNumber,
        prompt: params.prompt,
        model,
        deliveryUrl,
        deliveryToken,
        category: params.category ?? null,
      }),
    })
    .run();

  // Generate and store Vectorize embeddings for the new revision
  const embeddingText = `${roomType} ai_render ${params.prompt}`;
  try {
    await processor.generateAndStoreEmbeddings(
      outputImageId,
      embeddingText,
      deliveryUrl,
    );
  } catch (vectorError) {
    console.warn(
      `[Vectorize] Failed to store embeddings for revision image ${outputImageId}; continuing.`,
      vectorError,
    );
  }

  const revisionId = crypto.randomUUID();
  await db
    .insert(imageEditRevisions)
    .values({
      id: revisionId,
      sessionId,
      parentId:
        revisionRows.length > 0
          ? revisionRows.sort(
              (a, b) => (b.revisionNumber || 0) - (a.revisionNumber || 0),
            )[0]?.id || null
          : null,
      sourceImageId: params.sourceImageId,
      outputImageId,
      prompt: params.prompt,
      model,
      revisionNumber,
      startingImageUrl: sourceUrl,
      outputImageUrl: deliveryUrl,
      metadata: JSON.stringify({
        deliveryUrl,
        deliveryToken,
        category: params.category ?? null,
        usedBlankCanvas: !!params.blankCanvasImageId,
      }),
    })
    .run();

  await db
    .update(imageEditSessions)
    .set({
      sourceImageId: params.sourceImageId,
      datetimeLastModified: new Date(),
    })
    .where(eq(imageEditSessions.id, sessionId))
    .run();

  const revision = await db
    .select()
    .from(imageEditRevisions)
    .where(eq(imageEditRevisions.id, revisionId))
    .get();

  const outputImage = await db
    .select()
    .from(images)
    .where(eq(images.id, outputImageId))
    .get();

  return {
    success: true,
    revision,
    outputImage,
    deliveryUrl,
  };
}

// ---------------------------------------------------------------------------
// Single revision endpoint (backward-compatible)
// ---------------------------------------------------------------------------
photoEditsRouter.post("/sessions/:sessionId/revisions", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const contentType = c.req.header("content-type") || "";

    let prompt = "";
    let sourceImageId: string | null = null;
    let roomTypeInput: string | null = null;
    let maskBase64: string | null = null;
    let blankCanvasImageId: string | null = null;
    let category: string | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await c.req.formData();
      prompt = String(formData.get("prompt") || "").trim();
      const sourceInput = formData.get("sourceImageId");
      if (typeof sourceInput === "string" && sourceInput.trim().length > 0) {
        sourceImageId = sourceInput.trim();
      }
      const roomInput = formData.get("roomType");
      if (typeof roomInput === "string" && roomInput.trim().length > 0) {
        roomTypeInput = roomInput.trim().toLowerCase();
      }
      const maskInput = formData.get("maskBase64");
      if (typeof maskInput === "string" && maskInput.trim().length > 0) {
        maskBase64 = maskInput.trim();
      }
      const bcInput = formData.get("blankCanvasImageId");
      if (typeof bcInput === "string" && bcInput.trim().length > 0) {
        blankCanvasImageId = bcInput.trim();
      }
      const catInput = formData.get("category");
      if (typeof catInput === "string" && catInput.trim().length > 0) {
        category = catInput.trim();
      }
    } else {
      const body = (await c.req.json()) as {
        prompt?: string;
        sourceImageId?: string;
        roomType?: string;
        maskBase64?: string;
        blankCanvasImageId?: string;
        category?: string;
        inspoImageIds?: string[];
      };
      prompt = body.prompt?.trim() || "";
      if (body.sourceImageId) sourceImageId = body.sourceImageId;
      if (body.roomType) roomTypeInput = body.roomType.trim().toLowerCase();
      if (body.maskBase64) maskBase64 = body.maskBase64;
      if (body.blankCanvasImageId) blankCanvasImageId = body.blankCanvasImageId;
      if (body.category) category = body.category;
    }

    // Resolve sourceImageId from session if not explicitly provided
    if (!sourceImageId) {
      const db = drizzle(c.env.DB);
      const session = await db
        .select()
        .from(imageEditSessions)
        .where(eq(imageEditSessions.id, sessionId))
        .get();
      sourceImageId = session?.sourceImageId || null;
    }

    if (!prompt) {
      return c.json({ error: "Prompt is required" }, 400);
    }
    if (!sourceImageId) {
      return c.json({ error: "Source image is required" }, 400);
    }

    const result = await createSingleRevision(c.env, sessionId, {
      prompt,
      sourceImageId,
      roomType: roomTypeInput,
      maskBase64,
      blankCanvasImageId,
      category,
    });

    if (!result.success) {
      return c.json({ error: result.error }, 500);
    }

    return c.json(result);
  } catch (error) {
    console.error("Create revision error:", error);
    return c.json(
      {
        error: "Failed to create revision",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// Batch revision endpoint — processes multiple categories sequentially
// ---------------------------------------------------------------------------
photoEditsRouter.post("/sessions/:sessionId/revisions/batch", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const body = (await c.req.json()) as {
      revisions: Array<{
        prompt: string;
        sourceImageId: string;
        roomType?: string;
        maskBase64?: string;
        blankCanvasImageId?: string;
        category?: string;
        inspoImageIds?: string[];
      }>;
    };

    if (!Array.isArray(body.revisions) || body.revisions.length === 0) {
      return c.json({ error: "At least one revision spec is required" }, 400);
    }

    if (body.revisions.length > 10) {
      return c.json({ error: "Maximum 10 revisions per batch" }, 400);
    }

    const results: Array<{
      category: string | null;
      success: boolean;
      error?: string;
      revision?: any;
      outputImage?: any;
      deliveryUrl?: string;
    }> = [];

    for (const spec of body.revisions) {
      if (!spec.prompt?.trim()) {
        results.push({
          category: spec.category ?? null,
          success: false,
          error: "Prompt is required",
        });
        continue;
      }
      if (!spec.sourceImageId) {
        results.push({
          category: spec.category ?? null,
          success: false,
          error: "Source image is required",
        });
        continue;
      }

      const result = await createSingleRevision(c.env, sessionId, {
        prompt: spec.prompt.trim(),
        sourceImageId: spec.sourceImageId,
        roomType: spec.roomType,
        maskBase64: spec.maskBase64,
        blankCanvasImageId: spec.blankCanvasImageId,
        category: spec.category,
        inspoImageIds: spec.inspoImageIds,
      });

      results.push({
        category: spec.category ?? null,
        ...result,
      });
    }

    return c.json({
      success: results.every((r) => r.success),
      results,
    });
  } catch (error) {
    console.error("Batch revision error:", error);
    return c.json(
      {
        error: "Failed to process batch revisions",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { photoEditsRouter };
export default photoEditsRouter;
