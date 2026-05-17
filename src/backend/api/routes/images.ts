/**
 * @fileoverview Images API routes for remodel mood board
 */

import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";



import {
  imageUploadStaging,
  imageReviewHighlights,
  imageReviews,
  imageTagMappings,
  imageTags,
  images,
  inspirationalImageRooms,
  listingPhotos,
  rooms,
} from "@backend/db";
import { ensureHomeCatalogSeed } from "@backend/services/home-catalog";
import { resolveCloudflareImagesCredentials } from "@backend/utils/secrets";
import {
  ImageProcessorService,
  type PhotoCategory,
} from "../../services/image-processor";

const imagesRouter = new Hono<{ Bindings: Env }>();

type HighlightType = "like" | "dislike";

interface HighlightInput {
  id?: number;
  highlightType?: HighlightType;
  shapeType?: string;
  xPct?: number;
  yPct?: number;
  widthPct?: number;
  heightPct?: number;
  note?: string;
}

function slugifyTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
}

function titleizeTag(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((segment) =>
      segment.length > 0
        ? `${segment.charAt(0).toUpperCase()}${segment.slice(1).toLowerCase()}`
        : "",
    )
    .join(" ")
    .trim();
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(4))));
}

function parseStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        return parseStringArray(JSON.parse(trimmed) as unknown);
      } catch {
        return [];
      }
    }
    return trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function parseNumberArray(value: unknown): number[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry))
      .map((entry) => Math.trunc(entry));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        return parseNumberArray(JSON.parse(trimmed) as unknown);
      } catch {
        return [];
      }
    }
    return trimmed
      .split(",")
      .map((entry) => Number(entry.trim()))
      .filter((entry) => Number.isFinite(entry))
      .map((entry) => Math.trunc(entry));
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return [Math.trunc(value)];
  }
  return [];
}

function parseHighlightsInput(value: unknown): HighlightInput[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value as HighlightInput[];
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? (parsed as HighlightInput[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseRoomIdInput(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.trunc(parsed);
}

function hasDeliveryToken(value: string | null | undefined): value is string {
  return typeof value === "string" && value.includes("/");
}

function normalizePhotoCategory(
  raw: string | null | undefined,
  isListingPhoto: boolean,
): PhotoCategory {
  if (raw === "listing" || raw === "inspirational" || raw === "ai_render") {
    return raw;
  }
  return isListingPhoto ? "listing" : "inspirational";
}

function extractDeliveryTokenFromUrl(deliveryUrl: string): string | null {
  const parts = deliveryUrl.split("/").filter(Boolean);
  if (parts.length < 4) {
    return null;
  }
  return `${parts[2]}/${parts[3]}`;
}

function parseRoomIds(value: unknown): number[] {
  if (value === null || value === undefined) {
    return [];
  }

  const parsedValues: number[] = [];
  const consumeToken = (token: string) => {
    const trimmed = token.trim();
    if (!trimmed) {
      return;
    }
    const numberValue = Number(trimmed);
    if (Number.isFinite(numberValue)) {
      parsedValues.push(Math.trunc(numberValue));
    }
  };

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" || typeof entry === "number") {
        consumeToken(String(entry));
      }
    }
  } else if (typeof value === "number") {
    if (Number.isFinite(value)) {
      parsedValues.push(Math.trunc(value));
    }
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return parseRoomIds(parsed);
      } catch {
        // Fall back to delimiter parsing.
      }
    }

    for (const token of trimmed.split(",")) {
      consumeToken(token);
    }
  }

  return Array.from(new Set(parsedValues.filter((item) => item > 0)));
}

type MappingCategory = "listing" | "inspirational";

function toMappingCategory(
  rawCategory: string | null | undefined,
  isListingPhoto: boolean,
): MappingCategory {
  const normalized = normalizePhotoCategory(rawCategory, isListingPhoto);
  return normalized === "listing" ? "listing" : "inspirational";
}

function getImageDeliveryUrl(
  image:
    | Pick<typeof images.$inferSelect, "cfImageIdOptimized" | "cfImageIdOriginal">
    | null
    | undefined,
): string | null {
  if (!image) {
    return null;
  }
  const candidate = image.cfImageIdOptimized || image.cfImageIdOriginal;
  if (!candidate) {
    return null;
  }
  if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
    return candidate;
  }
  if (candidate.includes("/")) {
    return `https://imagedelivery.net/${candidate}/public`;
  }
  return null;
}

async function syncImageUploadStagingRows(
  db: ReturnType<typeof drizzle>,
  rows: Array<{
    imageId: string;
    photoCategory: MappingCategory;
    mapped: boolean;
  }>,
): Promise<void> {
  for (const row of rows) {
    await db
      .insert(imageUploadStaging)
      .values({
        imageId: row.imageId,
        photoCategory: row.photoCategory,
        mappingStatus: row.mapped ? "mapped" : "pending",
        datetimeMapped: row.mapped ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: imageUploadStaging.imageId,
        set: {
          photoCategory: row.photoCategory,
          mappingStatus: row.mapped ? "mapped" : "pending",
          datetimeMapped: row.mapped ? new Date() : null,
        },
      })
      .run();
  }
}

async function ensureTags(
  db: ReturnType<typeof drizzle>,
  rawTags: string[],
): Promise<Array<typeof imageTags.$inferSelect>> {
  const normalizedMap = new Map<string, { slug: string; label: string }>();
  for (const rawTag of rawTags) {
    const slug = slugifyTag(rawTag);
    if (!slug) continue;
    if (!normalizedMap.has(slug)) {
      normalizedMap.set(slug, { slug, label: titleizeTag(rawTag) });
    }
  }
  const normalized = Array.from(normalizedMap.values());

  if (normalized.length === 0) {
    return [];
  }

  await db
    .insert(imageTags)
    .values(
      normalized.map((tag) => ({
        slug: tag.slug,
        label: tag.label,
      })),
    )
    .onConflictDoNothing()
    .run();

  const slugs = normalized.map((tag) => tag.slug);
  return db.select().from(imageTags).where(inArray(imageTags.slug, slugs)).all();
}

function parseAiPrefillTagRationales(
  metadataRaw: string | null | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  if (!metadataRaw) {
    return map;
  }

  try {
    const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
    const aiPrefill =
      metadata.aiPrefill && typeof metadata.aiPrefill === "object"
        ? (metadata.aiPrefill as Record<string, unknown>)
        : null;
    const tagsRaw =
      aiPrefill?.tags && Array.isArray(aiPrefill.tags)
        ? (aiPrefill.tags as Array<Record<string, unknown>>)
        : [];

    for (const tagEntry of tagsRaw) {
      const value = typeof tagEntry.value === "string" ? tagEntry.value.trim() : "";
      const rationale =
        typeof tagEntry.rationale === "string" ? tagEntry.rationale.trim() : "";
      if (!value || !rationale) {
        continue;
      }
      map.set(slugifyTag(value), rationale);
    }
    return map;
  } catch {
    return map;
  }
}

function extractTagsFromMetadata(metadataRaw: string | null | undefined): string[] {
  if (!metadataRaw) return [];
  try {
    const metadata = JSON.parse(metadataRaw) as Record<string, unknown>;
    return parseStringArray(metadata.tags);
  } catch {
    return [];
  }
}

async function getTagMappingsByImageIds(
  db: ReturnType<typeof drizzle>,
  imageIds: string[],
): Promise<Map<string, Array<Record<string, unknown>>>> {
  const result = new Map<string, Array<Record<string, unknown>>>();
  if (imageIds.length === 0) {
    return result;
  }

  const mappings = await db
    .select()
    .from(imageTagMappings)
    .where(inArray(imageTagMappings.imageId, imageIds))
    .all();
  const tagIds = Array.from(new Set(mappings.map((mapping) => mapping.tagId)));
  const tags =
    tagIds.length > 0 ? await db.select().from(imageTags).where(inArray(imageTags.id, tagIds)).all() : [];
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));

  for (const mapping of mappings) {
    const tag = tagById.get(mapping.tagId);
    if (!tag) {
      continue;
    }
    const next = result.get(mapping.imageId) || [];
    next.push({
      id: mapping.id,
      tagId: tag.id,
      slug: tag.slug,
      label: tag.label,
      source: mapping.source,
      aiRationale: mapping.aiRationale,
      isAiPrefill: mapping.source === "ai_prefill",
    });
    result.set(mapping.imageId, next);
  }

  return result;
}

async function getHighlightsByImageIds(
  db: ReturnType<typeof drizzle>,
  imageIds: string[],
): Promise<Map<string, Array<typeof imageReviewHighlights.$inferSelect>>> {
  const result = new Map<string, Array<typeof imageReviewHighlights.$inferSelect>>();
  if (imageIds.length === 0) {
    return result;
  }

  const highlights = await db
    .select()
    .from(imageReviewHighlights)
    .where(inArray(imageReviewHighlights.imageId, imageIds))
    .all();

  for (const highlight of highlights) {
    const next = result.get(highlight.imageId) || [];
    next.push(highlight);
    result.set(highlight.imageId, next);
  }

  return result;
}

async function replaceImageTagMappings(
  db: ReturnType<typeof drizzle>,
  imageId: string,
  tagRows: Array<typeof imageTags.$inferSelect>,
  source: "manual" | "ai_prefill",
  rationaleBySlug?: Map<string, string>,
): Promise<void> {
  await db.delete(imageTagMappings).where(eq(imageTagMappings.imageId, imageId)).run();
  if (tagRows.length === 0) {
    return;
  }

  await db
    .insert(imageTagMappings)
    .values(
      tagRows.map((tagRow) => ({
        imageId,
        tagId: tagRow.id,
        source,
        aiRationale: rationaleBySlug?.get(tagRow.slug) ?? null,
      })),
    )
    .onConflictDoNothing()
    .run();
}

function extractMetadataSummary(metadataRaw: string | null | undefined): string | null {
  if (!metadataRaw) {
    return null;
  }
  try {
    const parsed = JSON.parse(metadataRaw) as Record<string, unknown>;
    const segments: string[] = [];

    const styleTheme =
      typeof parsed.styleTheme === "string" ? parsed.styleTheme.trim() : "";
    if (styleTheme) {
      segments.push(`theme:${styleTheme}`);
    }

    const materials = Array.isArray(parsed.materials)
      ? parsed.materials.map((value) => String(value).trim()).filter(Boolean)
      : [];
    if (materials.length > 0) {
      segments.push(`materials:${materials.slice(0, 4).join("|")}`);
    }

    const visibleElements = Array.isArray(parsed.visibleElements)
      ? parsed.visibleElements.map((value) => String(value).trim()).filter(Boolean)
      : [];
    if (visibleElements.length > 0) {
      segments.push(`visible:${visibleElements.slice(0, 4).join("|")}`);
    }

    const tags = Array.isArray(parsed.tags)
      ? parsed.tags.map((value) => String(value).trim()).filter(Boolean)
      : [];
    if (tags.length > 0) {
      segments.push(`tags:${tags.slice(0, 5).join("|")}`);
    }

    return segments.length > 0 ? segments.join(" ; ") : null;
  } catch {
    return null;
  }
}

function extractCloudflareImageId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const token = extractDeliveryTokenFromUrl(trimmed);
    if (!token) {
      return null;
    }
    const [, id] = token.split("/");
    return id || null;
  }

  if (trimmed.includes("/")) {
    const [, id] = trimmed.split("/");
    return id || null;
  }

  return trimmed;
}

type CloudflareCredentials = Awaited<
  ReturnType<typeof resolveCloudflareImagesCredentials>
>;

async function hydrateMissingDeliveryTokensForImages(params: {
  db: ReturnType<typeof drizzle>;
  credentials: CloudflareCredentials;
  sourceImages: Array<typeof images.$inferSelect>;
}): Promise<{ updatedCount: number }> {
  const { db, credentials, sourceImages } = params;
  if (!credentials.accountId || credentials.apiTokens.length === 0) {
    return { updatedCount: 0 };
  }

  let updatedCount = 0;
  for (const image of sourceImages) {
    if (
      hasDeliveryToken(image.cfImageIdOptimized) ||
      hasDeliveryToken(image.cfImageIdOriginal)
    ) {
      continue;
    }

    const candidateImageId = image.cfImageIdOptimized || image.cfImageIdOriginal;
    if (!candidateImageId) {
      continue;
    }

    let deliveryUrl: string | null = null;
    for (const token of credentials.apiTokens) {
      const response = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/images/v1/${candidateImageId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          continue;
        }
        break;
      }

      const payload = (await response.json()) as {
        success?: boolean;
        result?: { variants?: string[] };
      };
      if (!payload.success) {
        continue;
      }

      deliveryUrl = payload.result?.variants?.[0] || null;
      if (deliveryUrl) {
        break;
      }
    }

    if (!deliveryUrl) {
      continue;
    }

    const deliveryToken = extractDeliveryTokenFromUrl(deliveryUrl);
    if (!deliveryToken) {
      continue;
    }

    let nextMetadata: string | null = image.metadata;
    try {
      const parsed = image.metadata
        ? (JSON.parse(image.metadata) as Record<string, unknown>)
        : {};
      nextMetadata = JSON.stringify({
        ...parsed,
        deliveryUrl,
        deliveryToken,
      });
    } catch {
      nextMetadata = JSON.stringify({
        deliveryUrl,
        deliveryToken,
      });
    }

    await db
      .update(images)
      .set({
        cfImageIdOriginal: deliveryToken,
        metadata: nextMetadata,
      })
      .where(eq(images.id, image.id))
      .run();
    updatedCount += 1;
  }

  return { updatedCount };
}

/**
 * POST /api/images/upload
 * Upload images with AI analysis
 */
imagesRouter.post("/upload", async (c) => {
  try {
    const formData = await c.req.formData();
    const files: File[] = [];

    // Extract all files from form data
    for (const [_key, value] of formData.entries()) {
      if (value instanceof File) {
        files.push(value);
      }
    }

    if (files.length === 0) {
      return c.json({ error: "No files provided" }, 400);
    }

    // Check for account credentials
    const credentials = await resolveCloudflareImagesCredentials(c.env);

    if (!credentials.accountId || credentials.apiTokens.length === 0) {
      return c.json({ error: "Cloudflare credentials not configured" }, 500);
    }

    // Initialize image processor service
    const processor = new ImageProcessorService(
      c.env,
      credentials.accountId,
      credentials.apiTokens[0],
      {
        fallbackApiTokens: credentials.apiTokens.slice(1),
      },
    );

    // Process all images
    const isListingPhoto = formData.get("isListingPhoto") === "true";
    const rawCategory = formData.get("photoCategory");
    const photoCategory = normalizePhotoCategory(
      typeof rawCategory === "string" ? rawCategory : null,
      isListingPhoto,
    );
    const db = drizzle(c.env.DB);
    await ensureHomeCatalogSeed(c.env);

    const requestedRoomId = parseRoomIdInput(formData.get("roomId"));
    const selectedRoom = requestedRoomId
      ? await db.select().from(rooms).where(eq(rooms.id, requestedRoomId)).get()
      : null;
    const requestedInspirationalRoomIds = parseRoomIds(formData.getAll("roomIds"));
    const selectedInspirationalRooms =
      requestedInspirationalRoomIds.length > 0
        ? await db
            .select()
            .from(rooms)
            .where(inArray(rooms.id, requestedInspirationalRoomIds))
            .all()
        : [];

    if (photoCategory === "listing" && requestedRoomId && !selectedRoom) {
      return c.json({ error: "Selected room was not found" }, 404);
    }
    if (
      photoCategory === "inspirational" &&
      requestedInspirationalRoomIds.length > 0 &&
      selectedInspirationalRooms.length !== requestedInspirationalRoomIds.length
    ) {
      return c.json({ error: "One or more selected inspirational rooms were not found" }, 404);
    }

    let namingRoomLabels: string[] = [];
    let namingExistingDisplayNames: string[] = [];
    let namingReferenceMetadata: string[] = [];

    if (photoCategory === "listing" && selectedRoom) {
      namingRoomLabels = [selectedRoom.roomName];
      const siblingListings = await db
        .select({
          displayName: images.displayName,
          metadata: images.metadata,
        })
        .from(images)
        .where(and(eq(images.photoCategory, "listing"), eq(images.roomId, selectedRoom.id)))
        .all();

      namingExistingDisplayNames = siblingListings
        .map((row) => row.displayName?.trim() || "")
        .filter(Boolean);
      namingReferenceMetadata = siblingListings
        .map((row) => extractMetadataSummary(row.metadata))
        .filter((value): value is string => Boolean(value));
    }

    if (photoCategory === "inspirational" && selectedInspirationalRooms.length > 0) {
      namingRoomLabels = selectedInspirationalRooms.map((room) => room.roomName);
      const roomIds = selectedInspirationalRooms.map((room) => room.id);
      const priorMappings = await db
        .select({
          imageId: inspirationalImageRooms.imageId,
        })
        .from(inspirationalImageRooms)
        .where(inArray(inspirationalImageRooms.roomId, roomIds))
        .all();
      const priorImageIds = Array.from(
        new Set(priorMappings.map((row) => row.imageId).filter(Boolean)),
      );
      if (priorImageIds.length > 0) {
        const priorImages = await db
          .select({
            displayName: images.displayName,
            metadata: images.metadata,
            photoCategory: images.photoCategory,
          })
          .from(images)
          .where(inArray(images.id, priorImageIds))
          .all();
        const inspirationalPriorImages = priorImages.filter(
          (row) => row.photoCategory === "inspirational",
        );
        namingExistingDisplayNames = inspirationalPriorImages
          .map((row) => row.displayName?.trim() || "")
          .filter(Boolean);
        namingReferenceMetadata = inspirationalPriorImages
          .map((row) => extractMetadataSummary(row.metadata))
          .filter((value): value is string => Boolean(value));
      }
    }

    const results = await processor.processBulkImages(
      files,
      isListingPhoto,
      photoCategory,
      {
        roomAssignment: selectedRoom
          ? {
              roomId: selectedRoom.id,
              roomType: selectedRoom.roomName,
            }
          : undefined,
        namingHints: {
          roomLabels: namingRoomLabels,
          existingDisplayNames: namingExistingDisplayNames,
          referenceMetadata: namingReferenceMetadata,
        },
      },
    );

    const successfulImageIds = results
      .filter((result) => result.success && result.imageId)
      .map((result) => result.imageId);

    if (
      photoCategory === "inspirational" &&
      successfulImageIds.length > 0 &&
      selectedInspirationalRooms.length > 0
    ) {
      const mappingRows = successfulImageIds.flatMap((imageId) =>
        selectedInspirationalRooms.map((room) => ({
          imageId,
          roomId: room.id,
        })),
      );

      if (mappingRows.length > 0) {
        await db
          .insert(inspirationalImageRooms)
          .values(mappingRows)
          .onConflictDoNothing()
          .run();
      }
    }

    if (successfulImageIds.length > 0) {
      const mappedOnUpload =
        photoCategory === "listing"
          ? Boolean(selectedRoom)
          : selectedInspirationalRooms.length > 0;
      const mappingCategory = toMappingCategory(photoCategory, isListingPhoto);
      await syncImageUploadStagingRows(
        db,
        successfulImageIds.map((imageId) => ({
          imageId,
          photoCategory: mappingCategory,
          mapped: mappedOnUpload,
        })),
      );

      const insertedRows = await db
        .select({
          id: images.id,
          metadata: images.metadata,
        })
        .from(images)
        .where(inArray(images.id, successfulImageIds))
        .all();

      for (const insertedRow of insertedRows) {
        if (!insertedRow.metadata) {
          continue;
        }
        let parsedMetadata: Record<string, unknown> = {};
        try {
          parsedMetadata = JSON.parse(insertedRow.metadata) as Record<string, unknown>;
        } catch {
          parsedMetadata = {};
        }

        const tagCandidates = [
          ...parseStringArray(parsedMetadata.tags),
          ...parseStringArray(parsedMetadata.keywords),
        ];
        const tagRows = await ensureTags(db, tagCandidates);
        const rationaleBySlug = parseAiPrefillTagRationales(insertedRow.metadata);
        await replaceImageTagMappings(
          db,
          insertedRow.id,
          tagRows,
          "ai_prefill",
          rationaleBySlug,
        );
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const failureCount = results.length - successCount;

    return c.json({
      success: true,
      message: `Processed ${results.length} images: ${successCount} successful, ${failureCount} failed`,
      photoCategory,
      results,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return c.json(
      {
        error: "Failed to process images",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * GET /api/images/mapping/summary
 * Returns pending mapping counts for uploads staging.
 */
imagesRouter.get("/mapping/summary", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const pendingRows = await db
      .select({
        photoCategory: imageUploadStaging.photoCategory,
      })
      .from(imageUploadStaging)
      .where(eq(imageUploadStaging.mappingStatus, "pending"))
      .all();

    let listing = 0;
    let inspirational = 0;
    for (const row of pendingRows) {
      if (row.photoCategory === "listing") {
        listing += 1;
      } else {
        inspirational += 1;
      }
    }

    return c.json({
      success: true,
      pending: {
        listing,
        inspirational,
        total: listing + inspirational,
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load mapping summary",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * GET /api/images/mapping/pending
 * Lists pending unmapped images by category.
 */
imagesRouter.get("/mapping/pending", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const categoryQuery = c.req.query("photoCategory");
    if (
      categoryQuery &&
      categoryQuery !== "listing" &&
      categoryQuery !== "inspirational"
    ) {
      return c.json({ error: "photoCategory must be listing or inspirational" }, 400);
    }

    const pendingRowsRaw = await db
      .select()
      .from(imageUploadStaging)
      .where(eq(imageUploadStaging.mappingStatus, "pending"))
      .all();
    const pendingRows = categoryQuery
      ? pendingRowsRaw.filter((row) => row.photoCategory === categoryQuery)
      : pendingRowsRaw;

    if (pendingRows.length === 0) {
      return c.json({ success: true, count: 0, images: [] });
    }

    const imageIds = pendingRows.map((row) => row.imageId);
    const imageRows = await db.select().from(images).where(inArray(images.id, imageIds)).all();
    const imageById = new Map(imageRows.map((row) => [row.id, row]));

    const inspirationMappings = await db
      .select()
      .from(inspirationalImageRooms)
      .where(inArray(inspirationalImageRooms.imageId, imageIds))
      .all();
    const mappedRoomIds = Array.from(new Set(inspirationMappings.map((row) => row.roomId)));
    const mappedRooms =
      mappedRoomIds.length > 0
        ? await db.select().from(rooms).where(inArray(rooms.id, mappedRoomIds)).all()
        : [];
    const roomNameById = new Map(mappedRooms.map((room) => [room.id, room.roomName]));
    const roomIdsByImage = new Map<string, number[]>();
    for (const row of inspirationMappings) {
      const next = roomIdsByImage.get(row.imageId) || [];
      if (!next.includes(row.roomId)) {
        next.push(row.roomId);
      }
      roomIdsByImage.set(row.imageId, next);
    }

    const sorted = [...pendingRows].sort((a, b) => {
      const aTs = a.datetimeCreated ? new Date(a.datetimeCreated).getTime() : 0;
      const bTs = b.datetimeCreated ? new Date(b.datetimeCreated).getTime() : 0;
      return bTs - aTs;
    });

    const pendingImages = sorted
      .map((row) => {
        const image = imageById.get(row.imageId);
        if (!image) {
          return null;
        }
        const roomIds = roomIdsByImage.get(image.id) || [];
        const roomLabels = roomIds
          .map((roomId) => roomNameById.get(roomId))
          .filter((value): value is string => typeof value === "string");

        return {
          ...image,
          photoCategory: toMappingCategory(image.photoCategory, image.isListingPhoto),
          roomIds,
          roomLabels,
          deliveryUrl: getImageDeliveryUrl(image),
          pendingSince: row.datetimeCreated,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    return c.json({
      success: true,
      count: pendingImages.length,
      images: pendingImages,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load pending image mappings",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * POST /api/images/mapping/apply
 * Applies room mapping in bulk for pending listing/inspirational uploads.
 */
imagesRouter.post("/mapping/apply", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const body = (await c.req.json()) as Record<string, unknown>;
    await ensureHomeCatalogSeed(c.env);

    const categoryRaw =
      typeof body.photoCategory === "string" ? body.photoCategory : null;
    if (categoryRaw !== "listing" && categoryRaw !== "inspirational") {
      return c.json({ error: "photoCategory must be listing or inspirational" }, 400);
    }

    const imageIds = Array.isArray(body.imageIds)
      ? Array.from(
          new Set(
            body.imageIds
              .map((value) => String(value).trim())
              .filter((value) => value.length > 0),
          ),
        )
      : [];
    if (imageIds.length === 0) {
      return c.json({ error: "imageIds is required" }, 400);
    }

    const targetImages = await db
      .select()
      .from(images)
      .where(inArray(images.id, imageIds))
      .all();
    if (targetImages.length !== imageIds.length) {
      return c.json({ error: "One or more images were not found" }, 404);
    }

    const mismatched = targetImages.filter(
      (image) => toMappingCategory(image.photoCategory, image.isListingPhoto) !== categoryRaw,
    );
    if (mismatched.length > 0) {
      return c.json(
        {
          error: `Selected images must all be ${categoryRaw} photos`,
        },
        400,
      );
    }

    if (categoryRaw === "listing") {
      const roomId = Number(body.roomId);
      if (!Number.isFinite(roomId) || roomId <= 0) {
        return c.json({ error: "roomId is required for listing mapping" }, 400);
      }
      const selectedRoom = await db
        .select()
        .from(rooms)
        .where(eq(rooms.id, Math.trunc(roomId)))
        .get();
      if (!selectedRoom) {
        return c.json({ error: "Selected room was not found" }, 404);
      }

      await db
        .update(images)
        .set({
          roomId: selectedRoom.id,
          roomType: selectedRoom.roomName,
        })
        .where(inArray(images.id, imageIds))
        .run();
      await db
        .delete(inspirationalImageRooms)
        .where(inArray(inspirationalImageRooms.imageId, imageIds))
        .run();

      await syncImageUploadStagingRows(
        db,
        imageIds.map((imageId) => ({
          imageId,
          photoCategory: "listing",
          mapped: true,
        })),
      );

      return c.json({
        success: true,
        mappedCount: imageIds.length,
        photoCategory: "listing",
        room: {
          id: selectedRoom.id,
          roomName: selectedRoom.roomName,
        },
      });
    }

    const roomIds = parseRoomIds(body.roomIds);
    if (roomIds.length === 0) {
      return c.json({ error: "roomIds is required for inspirational mapping" }, 400);
    }
    const selectedRooms = await db.select().from(rooms).where(inArray(rooms.id, roomIds)).all();
    if (selectedRooms.length !== roomIds.length) {
      return c.json({ error: "One or more selected rooms were not found" }, 404);
    }

    await db
      .delete(inspirationalImageRooms)
      .where(inArray(inspirationalImageRooms.imageId, imageIds))
      .run();
    await db
      .insert(inspirationalImageRooms)
      .values(
        imageIds.flatMap((imageId) =>
          selectedRooms.map((room) => ({
            imageId,
            roomId: room.id,
          })),
        ),
      )
      .onConflictDoNothing()
      .run();

    const primaryRoom = selectedRooms[0] ?? null;
    await db
      .update(images)
      .set({
        roomId: null,
        roomType: primaryRoom?.roomName ?? null,
      })
      .where(inArray(images.id, imageIds))
      .run();

    await syncImageUploadStagingRows(
      db,
      imageIds.map((imageId) => ({
        imageId,
        photoCategory: "inspirational",
        mapped: true,
      })),
    );

    return c.json({
      success: true,
      mappedCount: imageIds.length,
      photoCategory: "inspirational",
      rooms: selectedRooms.map((room) => ({
        id: room.id,
        roomName: room.roomName,
        displayName: room.displayName,
      })),
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to apply image mapping",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * GET /api/images
 * List all images with optional filters
 */
imagesRouter.get("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const roomType = c.req.query("roomType");
    const isInstagram = c.req.query("isInstagram");
    const isListingPhoto = c.req.query("isListingPhoto");
    const photoCategory = c.req.query("photoCategory");

    let query = db.select().from(images);

    // Apply filters (this is simplified - in production use proper query builder)
    const allImages = await query.all();

    let filtered = allImages;

    if (roomType) {
      filtered = filtered.filter((img) => img.roomType === roomType);
    }

    if (isInstagram !== undefined) {
      const instagramFilter = isInstagram === "true";
      filtered = filtered.filter((img) => img.isInstagram === instagramFilter);
    }

    if (isListingPhoto !== undefined) {
      const listingFilter = isListingPhoto === "true";
      filtered = filtered.filter((img) => img.isListingPhoto === listingFilter);
    }

    if (photoCategory !== undefined) {
      filtered = filtered.filter((img) => {
        const normalized = normalizePhotoCategory(img.photoCategory, img.isListingPhoto);
        return normalized === photoCategory;
      });
    }

    filtered = filtered.map((image) => ({
      ...image,
      photoCategory: normalizePhotoCategory(image.photoCategory, image.isListingPhoto),
    }));

    const filteredImageIds = filtered.map((image) => image.id);
    const inspirationalMappings =
      filteredImageIds.length > 0
        ? await db
            .select()
            .from(inspirationalImageRooms)
            .where(inArray(inspirationalImageRooms.imageId, filteredImageIds))
            .all()
        : [];
    const mappedRoomIds = Array.from(
      new Set(inspirationalMappings.map((mapping) => mapping.roomId)),
    );
    const mappedRooms =
      mappedRoomIds.length > 0
        ? await db.select().from(rooms).where(inArray(rooms.id, mappedRoomIds)).all()
        : [];
    const roomNameById = new Map(mappedRooms.map((room) => [room.id, room.roomName]));
    const roomIdsByImage = new Map<string, number[]>();

    for (const mapping of inspirationalMappings) {
      const next = roomIdsByImage.get(mapping.imageId) || [];
      if (!next.includes(mapping.roomId)) {
        next.push(mapping.roomId);
      }
      roomIdsByImage.set(mapping.imageId, next);
    }

    const tagMappingsByImageId = await getTagMappingsByImageIds(db, filteredImageIds);
    const highlightsByImageId = await getHighlightsByImageIds(db, filteredImageIds);

    const enriched = filtered.map((image) => {
      const roomIds = roomIdsByImage.get(image.id) || [];
      const roomLabels = roomIds
        .map((roomId) => roomNameById.get(roomId))
        .filter((roomName): roomName is string => typeof roomName === "string");
      const tagMappings = tagMappingsByImageId.get(image.id) || [];
      const highlights = highlightsByImageId.get(image.id) || [];
      const tagsFromMappings = tagMappings
        .map((mapping) => mapping.label)
        .filter((value): value is string => typeof value === "string");
      const tagsFromMetadata = extractTagsFromMetadata(image.metadata);
      const tags = tagsFromMappings.length > 0 ? tagsFromMappings : tagsFromMetadata;

      return {
        ...image,
        roomIds,
        roomLabels,
        tagMappings,
        tags,
        highlights,
      };
    });

    return c.json({
      success: true,
      count: enriched.length,
      images: enriched,
    });
  } catch (error) {
    console.error("List images error:", error);
    return c.json(
      {
        error: "Failed to list images",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * POST /api/images/maintenance/resolve-delivery-tokens
 * Resolve missing imagedelivery tokens outside of GET/list requests.
 */
imagesRouter.post("/maintenance/resolve-delivery-tokens", async (c) => {
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      imageIds?: string[];
    };
    const db = drizzle(c.env.DB);
    const targetIds = Array.isArray(body.imageIds)
      ? body.imageIds.map((value) => String(value).trim()).filter(Boolean)
      : [];
    const sourceImages =
      targetIds.length > 0
        ? await db.select().from(images).where(inArray(images.id, targetIds)).all()
        : await db.select().from(images).all();
    const credentials = await resolveCloudflareImagesCredentials(c.env);
    const result = await hydrateMissingDeliveryTokensForImages({
      db,
      credentials,
      sourceImages,
    });

    return c.json({
      success: true,
      scannedCount: sourceImages.length,
      updatedCount: result.updatedCount,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to resolve image delivery tokens",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * GET /api/images/tags
 * List available tag definitions
 */
imagesRouter.get("/tags", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const tags = await db.select().from(imageTags).all();
    const sorted = tags.sort((a, b) => a.label.localeCompare(b.label));
    return c.json({
      success: true,
      tags: sorted,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list tags",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * POST /api/images/tags
 * Create a tag definition
 */
imagesRouter.post("/tags", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const body = (await c.req.json()) as Record<string, unknown>;
    const label = typeof body.label === "string" ? body.label.trim() : "";
    if (!label) {
      return c.json({ error: "Tag label is required" }, 400);
    }

    const slug = slugifyTag(label);
    if (!slug) {
      return c.json({ error: "Tag label is invalid" }, 400);
    }

    await db
      .insert(imageTags)
      .values({
        slug,
        label: titleizeTag(label),
      })
      .onConflictDoNothing()
      .run();

    const created = await db.select().from(imageTags).where(eq(imageTags.slug, slug)).get();
    if (!created) {
      return c.json({ error: "Failed to create tag" }, 500);
    }

    return c.json({
      success: true,
      tag: created,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to create tag",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * GET /api/images/:id
 * Get a specific image by ID
 */
imagesRouter.get("/:id", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const imageId = c.req.param("id");

    const result = await db.select().from(images).where(eq(images.id, imageId)).get();

    if (!result) {
      return c.json({ error: "Image not found" }, 404);
    }

    const mappingRows = await db
      .select()
      .from(inspirationalImageRooms)
      .where(eq(inspirationalImageRooms.imageId, imageId))
      .all();
    const roomIds = mappingRows.map((row) => row.roomId);
    const roomRows =
      roomIds.length > 0
        ? await db.select().from(rooms).where(inArray(rooms.id, roomIds)).all()
        : [];
    const roomLabels = roomRows.map((room) => room.roomName);
    const tagMappingsByImageId = await getTagMappingsByImageIds(db, [imageId]);
    const highlightsByImageId = await getHighlightsByImageIds(db, [imageId]);
    const tagMappings = tagMappingsByImageId.get(imageId) || [];
    const highlights = highlightsByImageId.get(imageId) || [];
    const tagsFromMappings = tagMappings
      .map((mapping) => mapping.label)
      .filter((entry): entry is string => typeof entry === "string");
    const tagsFromMetadata = extractTagsFromMetadata(result.metadata);
    const tags = tagsFromMappings.length > 0 ? tagsFromMappings : tagsFromMetadata;

    return c.json({
      success: true,
      image: {
        ...result,
        roomIds,
        roomLabels,
        tagMappings,
        tags,
        highlights,
      },
    });
  } catch (error) {
    console.error("Get image error:", error);
    return c.json(
      {
        error: "Failed to get image",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * PUT /api/images/:id
 * Update image metadata
 */
imagesRouter.put("/:id", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const imageId = c.req.param("id");
    const body = (await c.req.json()) as Record<string, unknown>;

    // Check if image exists
    const existing = await db.select().from(images).where(eq(images.id, imageId)).get();

    if (!existing) {
      return c.json({ error: "Image not found" }, 404);
    }

    // Update allowed fields
    const updates: Record<string, unknown> = {};
    await ensureHomeCatalogSeed(c.env);
    const requestedRoomId =
      body.roomId === null || body.roomId === undefined || body.roomId === ""
        ? null
        : Number(body.roomId);
    let selectedRoom: typeof rooms.$inferSelect | null = null;

    if (body.roomId !== undefined && body.roomId !== null && body.roomId !== "") {
      if (requestedRoomId === null || !Number.isFinite(requestedRoomId)) {
        return c.json({ error: "Invalid roomId" }, 400);
      }
      selectedRoom = (await db
        .select()
        .from(rooms)
        .where(eq(rooms.id, Math.trunc(requestedRoomId)))
        .get()) ?? null;
      if (!selectedRoom) {
        return c.json({ error: "Selected room was not found" }, 404);
      }
      updates.roomId = selectedRoom.id;
    } else if (body.roomId === null || body.roomId === "") {
      updates.roomId = null;
    }

    const roomType =
      body.roomType ??
      body.room ??
      (selectedRoom ? selectedRoom.roomName : undefined);
    if (roomType !== undefined) updates.roomType = roomType;
    if (body.instagramAccount !== undefined) updates.instagramAccount = body.instagramAccount;
    if (body.instagramCaption !== undefined) updates.instagramCaption = body.instagramCaption;
    if (body.displayName !== undefined) {
      const normalized =
        typeof body.displayName === "string" ? body.displayName.trim() : "";
      updates.displayName = normalized || null;
    }

    const nextCategory = normalizePhotoCategory(
      typeof body.photoCategory === "string" ? body.photoCategory : null,
      body.isListingPhoto === true ||
        existing.isListingPhoto ||
        body.photoCategory === "listing",
    );
    if (body.photoCategory !== undefined || body.isListingPhoto !== undefined) {
      updates.photoCategory = nextCategory;
      updates.isListingPhoto = nextCategory === "listing";
    }

    const roomIdsProvided = Object.prototype.hasOwnProperty.call(body, "roomIds");
    const requestedInspirationalRoomIds = roomIdsProvided
      ? parseRoomIds(body.roomIds)
      : [];
    const selectedInspirationalRooms =
      requestedInspirationalRoomIds.length > 0
        ? await db
            .select()
            .from(rooms)
            .where(inArray(rooms.id, requestedInspirationalRoomIds))
            .all()
        : [];

    if (
      roomIdsProvided &&
      requestedInspirationalRoomIds.length > 0 &&
      selectedInspirationalRooms.length !== requestedInspirationalRoomIds.length
    ) {
      return c.json({ error: "One or more selected rooms were not found" }, 404);
    }

    const effectiveRoomId =
      updates.roomId !== undefined ? updates.roomId : existing.roomId;
    const effectiveCategory =
      updates.photoCategory !== undefined
        ? String(updates.photoCategory)
        : normalizePhotoCategory(existing.photoCategory, existing.isListingPhoto);

    if (effectiveCategory === "listing" && !effectiveRoomId) {
      return c.json(
        { error: "Listing photos must be assigned to a room" },
        400,
      );
    }
    if (
      effectiveCategory === "inspirational" &&
      roomIdsProvided &&
      requestedInspirationalRoomIds.length === 0
    ) {
      return c.json(
        { error: "Inspirational photos must include at least one room" },
        400,
      );
    }

    let metadataObject: Record<string, unknown> = {};
    if (typeof existing.metadata === "string" && existing.metadata.trim().length > 0) {
      try {
        metadataObject = JSON.parse(existing.metadata) as Record<string, unknown>;
      } catch {
        metadataObject = {};
      }
    }

    if (body.metadata !== undefined) {
      if (typeof body.metadata === "string") {
        try {
          metadataObject = JSON.parse(body.metadata) as Record<string, unknown>;
        } catch {
          metadataObject = { raw: body.metadata };
        }
      } else if (body.metadata && typeof body.metadata === "object") {
        metadataObject = {
          ...metadataObject,
          ...(body.metadata as Record<string, unknown>),
        };
      }
    }

    const tagIdsProvided = Object.prototype.hasOwnProperty.call(body, "tagIds");
    const tagsProvided = Object.prototype.hasOwnProperty.call(body, "tags");
    const customTagsProvided = Object.prototype.hasOwnProperty.call(body, "customTags");
    let nextTagRows: Array<typeof imageTags.$inferSelect> | null = null;

    if (tagIdsProvided || tagsProvided || customTagsProvided) {
      const requestedTagIds = tagIdsProvided ? parseNumberArray(body.tagIds) : [];
      const selectedTagRows =
        requestedTagIds.length > 0
          ? await db.select().from(imageTags).where(inArray(imageTags.id, requestedTagIds)).all()
          : [];
      if (requestedTagIds.length > 0 && selectedTagRows.length !== requestedTagIds.length) {
        return c.json({ error: "One or more selected tags were not found" }, 404);
      }

      const enteredTagLabels = [
        ...parseStringArray(tagsProvided ? body.tags : []),
        ...parseStringArray(customTagsProvided ? body.customTags : []),
      ];
      const ensuredTags = await ensureTags(db, enteredTagLabels);
      const tagMap = new Map<number, typeof imageTags.$inferSelect>();
      for (const selectedTag of selectedTagRows) {
        tagMap.set(selectedTag.id, selectedTag);
      }
      for (const ensuredTag of ensuredTags) {
        tagMap.set(ensuredTag.id, ensuredTag);
      }
      nextTagRows = Array.from(tagMap.values());
      metadataObject.tags = nextTagRows.map((tagRow) => tagRow.label);
    }

    if (body.note !== undefined) {
      metadataObject.note = body.note;
    }

    const highlightsProvided = Object.prototype.hasOwnProperty.call(body, "highlights");
    const normalizedHighlights: Array<{
      highlightType: HighlightType;
      shapeType: string;
      xPct: number;
      yPct: number;
      widthPct: number;
      heightPct: number;
      note: string | null;
    }> = [];
    if (highlightsProvided) {
      const highlightsInput = parseHighlightsInput(body.highlights);
      for (const highlight of highlightsInput) {
        const xPct = Number(highlight.xPct);
        const yPct = Number(highlight.yPct);
        const widthPct = Number(highlight.widthPct);
        const heightPct = Number(highlight.heightPct);

        if (
          !Number.isFinite(xPct) ||
          !Number.isFinite(yPct) ||
          !Number.isFinite(widthPct) ||
          !Number.isFinite(heightPct)
        ) {
          continue;
        }
        if (widthPct <= 0 || heightPct <= 0) {
          continue;
        }

        normalizedHighlights.push({
          highlightType: highlight.highlightType === "dislike" ? "dislike" : "like",
          shapeType: typeof highlight.shapeType === "string" ? highlight.shapeType : "rect",
          xPct: clampPercent(xPct),
          yPct: clampPercent(yPct),
          widthPct: clampPercent(widthPct),
          heightPct: clampPercent(heightPct),
          note:
            typeof highlight.note === "string" && highlight.note.trim().length > 0
              ? highlight.note.trim().slice(0, 1200)
              : null,
        });
      }
    }

    if (Object.keys(metadataObject).length > 0 || body.metadata !== undefined) {
      updates.metadata = JSON.stringify(metadataObject);
    }

    if (
      Object.keys(updates).length === 0 &&
      nextTagRows === null &&
      !highlightsProvided
    ) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    await db.update(images).set(updates).where(eq(images.id, imageId)).run();

    if (effectiveCategory !== "inspirational" || roomIdsProvided) {
      await db
        .delete(inspirationalImageRooms)
        .where(eq(inspirationalImageRooms.imageId, imageId))
        .run();
    }

    if (
      effectiveCategory === "inspirational" &&
      roomIdsProvided &&
      selectedInspirationalRooms.length > 0
    ) {
      await db
        .insert(inspirationalImageRooms)
        .values(
          selectedInspirationalRooms.map((room) => ({
            imageId,
            roomId: room.id,
          })),
        )
        .onConflictDoNothing()
        .run();
    }

    if (nextTagRows !== null) {
      await replaceImageTagMappings(db, imageId, nextTagRows, "manual");
    }

    if (highlightsProvided) {
      await db
        .delete(imageReviewHighlights)
        .where(eq(imageReviewHighlights.imageId, imageId))
        .run();
      if (normalizedHighlights.length > 0) {
        await db
          .insert(imageReviewHighlights)
          .values(
            normalizedHighlights.map((highlight) => ({
              imageId,
              ...highlight,
            })),
          )
          .run();
      }
    }

    let mapped = false;
    const mappingCategory: MappingCategory =
      effectiveCategory === "listing" ? "listing" : "inspirational";
    if (mappingCategory === "listing") {
      mapped = Boolean(effectiveRoomId);
    } else {
      const remainingMappings = await db
        .select({ id: inspirationalImageRooms.id })
        .from(inspirationalImageRooms)
        .where(eq(inspirationalImageRooms.imageId, imageId))
        .all();
      mapped = remainingMappings.length > 0;
    }
    await syncImageUploadStagingRows(db, [
      {
        imageId,
        photoCategory: mappingCategory,
        mapped,
      },
    ]);

    // Get updated record
    const updated = await db.select().from(images).where(eq(images.id, imageId)).get();
    const mappingRows = await db
      .select()
      .from(inspirationalImageRooms)
      .where(eq(inspirationalImageRooms.imageId, imageId))
      .all();
    const roomIds = mappingRows.map((row) => row.roomId);
    const roomRows =
      roomIds.length > 0
        ? await db.select().from(rooms).where(inArray(rooms.id, roomIds)).all()
        : [];
    const roomLabels = roomRows.map((room) => room.roomName);
    const tagMappingsByImageId = await getTagMappingsByImageIds(db, [imageId]);
    const highlightsByImageId = await getHighlightsByImageIds(db, [imageId]);
    const tagMappings = tagMappingsByImageId.get(imageId) || [];
    const highlights = highlightsByImageId.get(imageId) || [];
    const tagsFromMappings = tagMappings
      .map((mapping) => mapping.label)
      .filter((entry): entry is string => typeof entry === "string");
    const tagsFromMetadata = extractTagsFromMetadata(updated?.metadata);
    const tags = tagsFromMappings.length > 0 ? tagsFromMappings : tagsFromMetadata;

    return c.json({
      success: true,
      image: updated
        ? {
            ...updated,
            roomIds,
            roomLabels,
            tagMappings,
            tags,
            highlights,
          }
        : null,
    });
  } catch (error) {
    console.error("Update image error:", error);
    return c.json(
      {
        error: "Failed to update image",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * DELETE /api/images/:id
 * Delete an image
 */
imagesRouter.delete("/:id", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const imageId = c.req.param("id");

    // Check if image exists
    const existing = await db.select().from(images).where(eq(images.id, imageId)).get();

    if (!existing) {
      return c.json({ error: "Image not found" }, 404);
    }

    const credentials = await resolveCloudflareImagesCredentials(c.env);
    const candidateCloudflareIds = Array.from(
      new Set(
        [existing.cfImageIdOriginal, existing.cfImageIdOptimized]
          .map((value) => extractCloudflareImageId(value))
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    );

    if (
      credentials.accountId &&
      credentials.apiTokens.length > 0 &&
      candidateCloudflareIds.length > 0
    ) {
      for (const cloudflareId of candidateCloudflareIds) {
        for (const token of credentials.apiTokens) {
          try {
            const response = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${credentials.accountId}/images/v1/${cloudflareId}`,
              {
                method: "DELETE",
                headers: {
                  Authorization: `Bearer ${token}`,
                },
              },
            );

            if (response.ok || response.status === 404) {
              break;
            }

            if (response.status === 401 || response.status === 403) {
              continue;
            }
          } catch {
            // Continue best-effort cleanup across remaining tokens.
          }
        }
      }
    }

    await db.delete(imageReviews).where(eq(imageReviews.id, imageId)).run();
    await db.delete(listingPhotos).where(eq(listingPhotos.imageId, imageId)).run();
    await db
      .delete(inspirationalImageRooms)
      .where(eq(inspirationalImageRooms.imageId, imageId))
      .run();

    // Delete from D1 images table
    await db.delete(images).where(eq(images.id, imageId)).run();

    return c.json({
      success: true,
      message: "Image deleted successfully",
    });
  } catch (error) {
    console.error("Delete image error:", error);
    return c.json(
      {
        error: "Failed to delete image",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * POST /api/images/:id/replace
 * Replace an existing image asset with a newly uploaded file
 */
imagesRouter.post("/:id/replace", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const imageId = c.req.param("id");

    const existing = await db.select().from(images).where(eq(images.id, imageId)).get();
    if (!existing) {
      return c.json({ error: "Image not found" }, 404);
    }

    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "No file provided" }, 400);
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
    const uploadResponse = await processor.uploadToCloudflareImages(file, undefined, file.name);

    if (!uploadResponse.success) {
      return c.json({ error: "Failed to upload replacement image" }, 500);
    }

    const deliveryUrl = processor.getDeliveryUrl(uploadResponse, uploadResponse.result.id);
    const deliveryUrlParts = deliveryUrl.split("/").filter(Boolean);
    const deliveryToken =
      deliveryUrlParts.length >= 4
        ? `${deliveryUrlParts[2]}/${deliveryUrlParts[3]}`
        : uploadResponse.result.id;
    const nowEpochSeconds = Math.floor(Date.now() / 1000);

    const nextMetadata =
      typeof existing.metadata === "string" && existing.metadata.trim().length > 0
        ? (() => {
            try {
              const parsed = JSON.parse(existing.metadata) as Record<string, unknown>;
              return JSON.stringify({
                ...parsed,
                replacementImageId: uploadResponse.result.id,
                deliveryUrl,
                deliveryToken,
                replacedAt: nowEpochSeconds,
              });
            } catch {
              return JSON.stringify({
                replacementImageId: uploadResponse.result.id,
                deliveryUrl,
                deliveryToken,
                replacedAt: nowEpochSeconds,
              });
            }
          })()
        : JSON.stringify({
            replacementImageId: uploadResponse.result.id,
            deliveryUrl,
            deliveryToken,
            replacedAt: nowEpochSeconds,
          });

    await db
      .update(images)
      .set({
        cfImageIdOriginal: deliveryToken,
        cfImageIdOptimized: null,
        metadata: nextMetadata,
      })
      .where(eq(images.id, imageId))
      .run();

    // Keep photo-review records in sync when they share the same image ID.
    await db
      .update(imageReviews)
      .set({
        path: deliveryUrl,
        updatedAt: new Date(),
      })
      .where(eq(imageReviews.id, imageId))
      .run();

    const updated = await db.select().from(images).where(eq(images.id, imageId)).get();

    return c.json({
      success: true,
      image: updated,
      deliveryUrl,
    });
  } catch (error) {
    console.error("Replace image error:", error);
    return c.json(
      {
        error: "Failed to replace image",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

/**
 * POST /api/images/search
 * Semantic search for images
 */
imagesRouter.post("/search", async (c) => {
  try {
    const body = await c.req.json();
    const { query, topK = 10 } = body;

    if (!query) {
      return c.json({ error: "Query is required" }, 400);
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

    const results = await processor.searchImages(query, topK);

    // Fetch full image details from D1
    const db = drizzle(c.env.DB);
    const imageIds = results.matches.map((m) => m.id);

    const imageDetails = await Promise.all(
      imageIds.map((id) => db.select().from(images).where(eq(images.id, id)).get()),
    );

    return c.json({
      success: true,
      query,
      count: results.matches.length,
      results: results.matches.map((match, idx) => ({
        ...match,
        image: imageDetails[idx],
      })),
    });
  } catch (error) {
    console.error("Search error:", error);
    return c.json(
      {
        error: "Failed to search images",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { imagesRouter };
