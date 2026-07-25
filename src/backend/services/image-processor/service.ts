import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray } from "drizzle-orm";
import exifr from "exifr";
import { imageTagMappings, imageTags, images, imageReviews } from "@backend/db";
import { WorkersAIProvider } from "@backend/ai/providers/workers-ai";
import { modelRegistry } from "@backend/ai/models/index";
import {
  buildImageUploadFingerprintFromBytes,
  type ImageUploadFingerprint,
} from "@/services/image-processor/deduplication";

import type {
  ImageAnalysisResult,
  PhotoReviewAnalysis,
  CloudflareImagesResponse,
  CloudflareImagesUploadRequestOptions,
  ImageRoomAssignmentOptions,
  ImageNamingHints,
  ImageAnalysisContext,
  BuildImageMetadataOptions,
  ProcessImageResult,
  PhotoCategory,
} from "./types";

import {
  IMAGE_ANALYSIS_SCHEMA,
  PHOTO_REVIEW_SCHEMA,
  VECTOR_EMBED_MODEL,
  normalizePhotoCategory,
  isUuid,
  deriveDisplayName,
  toTitleCase,
  sanitizeDisplayName,
  ensureUniqueDisplayName,
  normalizeTagValue,
  slugifyTag,
  titleizeTag,
  buildAiPrefillPayload,
} from "./helpers";

/** Split `values` into slices of at most `size` (D1 caps a statement at 100 bound params). */
function chunk<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/** Compact photo metadata extracted at upload time (stored in the image row's JSON). */
export interface PhotoMetadata {
  width?: number;
  height?: number;
  format?: string;
  cameraMake?: string;
  cameraModel?: string;
  takenAt?: string;
  gps?: { lat: number; lng: number };
}

export class ImageProcessorService {
  private provider: WorkersAIProvider;
  private ai: Ai;
  private vectorIndex: VectorizeIndex;
  private db: D1Database;
  private images: ImagesBinding;
  private accountId: string;
  private apiTokens: string[];

  constructor(
    env: Env,
    accountId: string,
    apiToken: string,
    options?: {
      fallbackApiTokens?: string[];
    },
  ) {
    this.provider = new WorkersAIProvider(env);
    this.ai = env.AI;
    this.vectorIndex = env.PHOTO_INDEX;
    this.db = env.DB;
    this.images = env.IMAGES;
    this.accountId = accountId;
    this.apiTokens = Array.from(
      new Set(
        [apiToken, ...(options?.fallbackApiTokens || [])]
          .map((token) => token.trim())
          .filter((token) => token.length > 0),
      ),
    );
  }

  static extractDeliveryTokenFromUrl(deliveryUrl: string): string | null {
    try {
      const url = new URL(deliveryUrl);
      const segments = url.pathname.split("/").filter(Boolean);
      if (segments.length < 2) {
        return null;
      }
      return `${segments[0]}/${segments[1]}`;
    } catch {
      return null;
    }
  }

  static deriveDisplayNameFromFilename(filename: string): string {
    return deriveDisplayName(filename);
  }

  static parseMetadata(
    raw: string | null | undefined,
  ): Record<string, unknown> {
    if (!raw || raw.trim().length === 0) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  // -------------------------------------------------------------------------
  // Vision analysis — llama-3.2-11b-vision-instruct
  // -------------------------------------------------------------------------

  /**
   * Analyze an image with the vision model to extract a raw text description.
   * The vision model doesn't support json_schema, so we get free-text back.
   */
  async describeImage(imageDataUrl: string): Promise<string> {
    let finalDataUrl = imageDataUrl;
    if (
      imageDataUrl.startsWith("http://") ||
      imageDataUrl.startsWith("https://")
    ) {
      try {
        const response = await fetch(imageDataUrl);
        if (!response.ok) {
          throw new Error(
            `Failed to fetch image from URL: ${response.statusText} (${response.status})`,
          );
        }
        const contentType =
          response.headers.get("content-type") || "image/jpeg";
        const buffer = await response.arrayBuffer();
        finalDataUrl = ImageProcessorService.arrayBufferToDataUrl(
          buffer,
          contentType,
        );
      } catch (err) {
        console.error(
          "Error fetching and converting remote image to data URL:",
          err,
        );
        throw new Error(
          `Failed to download and encode remote image: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const result = await this.provider.invokeModel(modelRegistry.vision, {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Analyze this interior design/architecture photo thoroughly.
Describe: 1) What room or space this is (kitchen, bathroom, living room, bedroom, backyard, exterior, etc.)
2) Style elements, materials, colors, textures visible
3) Whether this appears to be an Instagram screenshot (look for UI: username bar, likes, comments, story ring)
4) If Instagram: the account handle and any visible caption text
Be specific and detailed.`,
            },
            {
              type: "image_url",
              image_url: { url: finalDataUrl },
            },
          ],
        },
      ],
      max_tokens: 1024,
    });

    return result.response;
  }

  async describeImageFromDeliveryUrl(deliveryUrl: string): Promise<string> {
    return this.describeImage(deliveryUrl);
  }

  // -------------------------------------------------------------------------
  // Structured reasoning — kimi-k2.6 with json_schema
  // -------------------------------------------------------------------------

  /**
   * Parse a vision model's free-text description into structured data using
   * kimi-k2.6 with response_format: { type: "json_schema" }.
   *
   * This ensures deterministic JSON output without regex hacks.
   */
  async analyzeVisionSummary(
    visionDescription: string,
    options?: ImageAnalysisContext,
  ): Promise<ImageAnalysisResult> {
    const roomLabels = (options?.roomLabels || []).filter(Boolean);
    const existingDisplayNames = (options?.existingDisplayNames || [])
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 40);
    const referenceMetadata = (options?.referenceMetadata || [])
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 25);
    const category = options?.photoCategory || "inspirational";

    const structured = (await this.provider.invokeStructured(
      modelRegistry.extract,
      {
        messages: [
          {
            role: "system",
            content: `You are an expert interior design analyst. Extract structured metadata from the provided image description.
Always respond with valid JSON matching the schema.
Return a concise, user-friendly suggestedDisplayName that is descriptive and distinct.`,
          },
          {
            role: "user",
            content: `Analyze the following image description and extract structured metadata.

Photo category: ${category}
Room hint: ${options?.roomHint || "none"}
Selected room labels: ${roomLabels.join(", ") || "none"}
Existing display names in these rooms (avoid duplicates): ${
              existingDisplayNames.join(" | ") || "none"
            }
Related metadata from prior photos:
${referenceMetadata.length > 0 ? referenceMetadata.join("\n- ") : "none"}

Use this context to produce a unique and readable suggestedDisplayName.

Image description:
${visionDescription}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: IMAGE_ANALYSIS_SCHEMA,
        },
      },
    )) as {
      roomType: string;
      keywords: string[];
      suggestedDisplayName: string;
      styleTheme: string;
      materials: string[];
      visibleElements: string[];
      isInstagram: boolean;
      instagramAccount: string | null;
      instagramCaption: string | null;
    };

    return {
      roomType: structured.roomType || "unknown",
      keywords: Array.isArray(structured.keywords) ? structured.keywords : [],
      suggestedDisplayName:
        typeof structured.suggestedDisplayName === "string"
          ? structured.suggestedDisplayName
          : "",
      styleTheme:
        typeof structured.styleTheme === "string" ? structured.styleTheme : "",
      materials: Array.isArray(structured.materials)
        ? structured.materials
            .map((item) => String(item).trim())
            .filter(Boolean)
        : [],
      visibleElements: Array.isArray(structured.visibleElements)
        ? structured.visibleElements
            .map((item) => String(item).trim())
            .filter(Boolean)
        : [],
      isInstagram: structured.isInstagram || false,
      instagramAccount: structured.instagramAccount || undefined,
      instagramCaption: structured.instagramCaption || undefined,
      needsCrop: structured.isInstagram || false,
    };
  }

  async analyzeImage(
    imageDataUrl: string,
    options?: ImageAnalysisContext,
  ): Promise<ImageAnalysisResult> {
    const visionDescription = await this.describeImage(imageDataUrl);
    return this.analyzeVisionSummary(visionDescription, options);
  }

  /**
   * Lightweight analysis for photo-reviews: returns room + tags only.
   * Uses vision → structured reasoning pipeline.
   */
  async analyzePhotoReview(imageDataUrl: string): Promise<PhotoReviewAnalysis> {
    const visionDescription = await this.describeImage(imageDataUrl);

    const structured = (await this.provider.invokeStructured(
      modelRegistry.extract,
      {
        messages: [
          {
            role: "system",
            content: `You are an interior design photo analyst. Extract the room type and descriptive tags from the image description. Return lowercase values.`,
          },
          {
            role: "user",
            content: `Extract the room type and tags from this image description:\n\n${visionDescription}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: PHOTO_REVIEW_SCHEMA,
        },
      },
    )) as { room: string; tags: string[] };

    return {
      room: (structured.room || "unassigned").toLowerCase(),
      tags: Array.isArray(structured.tags)
        ? structured.tags.map((t: string) => t.toLowerCase())
        : [],
    };
  }

  // -------------------------------------------------------------------------
  // Cloudflare Images upload
  // -------------------------------------------------------------------------

  private async createImagesBatchToken(): Promise<string | null> {
    const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v1/batch_token`;

    for (const token of this.apiTokens) {
      for (const method of ["POST", "GET"] as const) {
        try {
          const response = await fetch(apiUrl, {
            method,
            headers: {
              Authorization: `Bearer ${token}`,
            },
          });

          if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 401 || response.status === 403) {
              break;
            }
            if (response.status === 404 || response.status === 405) {
              continue;
            }
            console.warn(
              `[Images API] Failed to create batch token (${response.status} ${method}): ${errorText}`,
            );
            continue;
          }

          const payload = (await response.json()) as {
            success?: boolean;
            result?: { token?: string };
          };

          if (payload.success && payload.result?.token) {
            return payload.result.token;
          }
        } catch (error) {
          console.warn("[Images API] Batch token request failed:", error);
        }
      }
    }

    return null;
  }

  /**
   * Cloudflare Images REST storage rejects HEIC/HEIF on ingest (common for
   * iPhone photos). The IMAGES binding CAN decode HEIC, so transcode to JPEG
   * before upload. Web-safe formats pass through untouched. Best-effort: on any
   * transcode failure we fall back to the original bytes (the REST upload will
   * surface a clear error if it truly can't handle them).
   */
  private async normalizeForCfImages(
    imageBlob: Blob,
    filename?: string,
  ): Promise<{ blob: Blob; filename?: string }> {
    const type = (imageBlob.type || "").toLowerCase();
    const name = (filename || "").toLowerCase();
    const isHeic =
      type.includes("heic") ||
      type.includes("heif") ||
      name.endsWith(".heic") ||
      name.endsWith(".heif");
    if (!isHeic) return { blob: imageBlob, filename };

    try {
      const out = await this.images.input(imageBlob.stream()).output({ format: "image/jpeg" });
      const jpeg = await out.response().blob();
      const jpegName = filename ? filename.replace(/\.(heic|heif)$/i, ".jpg") : "image.jpg";
      return { blob: jpeg, filename: jpegName };
    } catch (err) {
      console.warn("[Images] HEIC→JPEG transcode failed, uploading original:", err);
      return { blob: imageBlob, filename };
    }
  }

  /**
   * Extract photo metadata from the ORIGINAL bytes for storage: EXIF (camera,
   * capture time, exposure, GPS-if-present) via exifr, plus format/dimensions
   * via the free IMAGES.info() call. Best-effort — returns {} on any failure so
   * it can never break an upload. NOTE: Google Photos strips GPS from its API
   * bytes, so `gps` is virtually always null for Google imports.
   */
  async extractPhotoMetadata(imageBlob: Blob): Promise<PhotoMetadata> {
    const meta: PhotoMetadata = {};

    try {
      const info = await this.images.info(imageBlob.stream());
      if ("width" in info) {
        meta.width = info.width;
        meta.height = info.height;
        meta.format = info.format;
      }
    } catch {
      /* info unavailable — skip dimensions */
    }

    try {
      const buf = await imageBlob.arrayBuffer();
      const exif = (await exifr.parse(buf, { tiff: true, exif: true, gps: true })) as
        | Record<string, unknown>
        | undefined;
      if (exif) {
        meta.cameraMake = typeof exif.Make === "string" ? exif.Make.trim() : undefined;
        meta.cameraModel = typeof exif.Model === "string" ? exif.Model.trim() : undefined;
        const taken = exif.DateTimeOriginal ?? exif.CreateDate;
        if (taken instanceof Date) meta.takenAt = taken.toISOString();
        else if (typeof taken === "string") meta.takenAt = taken;
        if (typeof exif.latitude === "number" && typeof exif.longitude === "number") {
          meta.gps = { lat: exif.latitude, lng: exif.longitude };
        }
      }
    } catch {
      /* no EXIF / parse failed (Google likely stripped it) */
    }

    return meta;
  }

  async uploadToCloudflareImages(
    imageBlob: Blob,
    customId?: string,
    filename?: string,
    options?: CloudflareImagesUploadRequestOptions,
  ): Promise<CloudflareImagesResponse> {
    ({ blob: imageBlob, filename } = await this.normalizeForCfImages(imageBlob, filename));
    const apiUrl =
      options?.endpoint ||
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v1`;
    const tokens = options?.authTokenOverride
      ? [options.authTokenOverride]
      : this.apiTokens;
    const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
    let lastError: Error | null = null;

    for (const token of tokens) {
      let lastErrorText = "";
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const formData = new FormData();
        formData.append("file", imageBlob, filename || "image.jpg");
        if (customId && !isUuid(customId)) {
          formData.append("id", customId);
        }

        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        });

        if (response.ok) {
          return (await response.json()) as CloudflareImagesResponse;
        }

        const errorText = await response.text();
        lastErrorText = errorText;

        if (response.status === 429 || response.status >= 500) {
          console.warn(
            `[Images API] ${response.status} Error (Attempt ${attempt}/${maxAttempts}):`,
            errorText,
          );
          if (attempt < maxAttempts) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
            continue;
          }
        }

        const error = new Error(
          `Failed to upload to Cloudflare Images (${response.status}): ${errorText}`,
        );
        lastError = error;

        const isAuthError = response.status === 401 || response.status === 403;
        if (isAuthError) {
          break;
        }

        throw error;
      }

      if (lastErrorText.length > 0) {
        lastError = new Error(
          `Failed to upload to Cloudflare Images after ${maxAttempts} attempts. Last error: ${lastErrorText}`,
        );
      }
    }

    throw lastError || new Error("Failed to upload to Cloudflare Images");
  }

  /**
   * Delete an image from Cloudflare Images by its custom ID.
   * Best-effort — logs errors but does not throw so callers can proceed with
   * DB cleanup even if the CF Images delete fails.
   */
  async deleteFromCloudflareImages(imageId: string): Promise<boolean> {
    const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v1/${imageId}`;
    for (const token of this.apiTokens) {
      try {
        const res = await fetch(apiUrl, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok || res.status === 404) return true; // 404 = already gone
        const text = await res.text();
        console.warn(`[Images API] delete ${imageId} → ${res.status}: ${text}`);
        if (res.status === 401 || res.status === 403) continue; // try next token
        return false;
      } catch (err) {
        console.error(`[Images API] delete ${imageId} error:`, err);
      }
    }
    return false;
  }

  getDeliveryUrl(
    uploadResponse: CloudflareImagesResponse,
    fallbackId: string,
  ): string {
    if (
      uploadResponse.result.variants &&
      uploadResponse.result.variants.length > 0
    ) {
      return uploadResponse.result.variants[0];
    }
    return `https://imagedelivery.net/${this.accountId}/${fallbackId}/public`;
  }

  deriveUniqueDisplayName(
    suggestedDisplayName: string,
    existingDisplayNames: string[],
    fallbackDisplayName: string,
  ): string {
    return ensureUniqueDisplayName(
      sanitizeDisplayName(suggestedDisplayName || "") ||
        sanitizeDisplayName(fallbackDisplayName || "") ||
        "Untitled photo",
      existingDisplayNames,
    );
  }

  buildImageMetadata(
    analysis: ImageAnalysisResult,
    options: BuildImageMetadataOptions,
  ): Record<string, unknown> {
    const aiPrefill = buildAiPrefillPayload(
      analysis,
      options.displayName,
      options.assignedRoomType,
    );

    return {
      tags: aiPrefill.tags.map((tag) => tag.value),
      note: aiPrefill.note.value || "",
      keywords: analysis.keywords,
      styleTheme: analysis.styleTheme || null,
      materials: analysis.materials,
      visibleElements: analysis.visibleElements,
      aiAnalysis: {
        roomType: analysis.roomType,
        isInstagram: analysis.isInstagram,
        suggestedDisplayName: analysis.suggestedDisplayName,
      },
      aiPrefill,
      assignedRoomType: options.assignedRoomType,
      assignedRoomId: options.assignedRoomId ?? null,
      deliveryUrl: options.deliveryUrl ?? null,
      deliveryToken: options.deliveryToken ?? null,
    };
  }

  mergeImageMetadata(
    existingMetadataRaw: string | null | undefined,
    nextMetadata: Record<string, unknown>,
  ): string {
    const existingMetadata =
      ImageProcessorService.parseMetadata(existingMetadataRaw);
    const merged: Record<string, unknown> = {
      ...existingMetadata,
      ...nextMetadata,
    };

    const existingTags = existingMetadata.tags;
    if (Array.isArray(existingTags) && existingTags.length > 0) {
      merged.tags = existingTags;
    }

    const existingNote = existingMetadata.note;
    if (typeof existingNote === "string" && existingNote.trim().length > 0) {
      merged.note = existingNote;
    }

    const existingDeliveryUrl = existingMetadata.deliveryUrl;
    if (
      typeof existingDeliveryUrl === "string" &&
      existingDeliveryUrl.trim().length > 0
    ) {
      merged.deliveryUrl = existingDeliveryUrl;
    }

    const existingDeliveryToken = existingMetadata.deliveryToken;
    if (
      typeof existingDeliveryToken === "string" &&
      existingDeliveryToken.trim().length > 0
    ) {
      merged.deliveryToken = existingDeliveryToken;
    }

    return JSON.stringify(merged);
  }

  async replaceAiPrefillTagMappings(
    imageId: string,
    tags: string[],
    rationaleBySlug?: Map<string, string>,
  ): Promise<{ skipped: boolean; count: number }> {
    const dbClient = drizzle(this.db);
    const manualMappings = await dbClient
      .select({ id: imageTagMappings.id })
      .from(imageTagMappings)
      .where(
        and(
          eq(imageTagMappings.imageId, imageId),
          eq(imageTagMappings.source, "manual"),
        ),
      )
      .all();

    if (manualMappings.length > 0) {
      return { skipped: true, count: 0 };
    }

    await dbClient
      .delete(imageTagMappings)
      .where(
        and(
          eq(imageTagMappings.imageId, imageId),
          eq(imageTagMappings.source, "ai_prefill"),
        ),
      )
      .run();

    const normalizedMap = new Map<string, { slug: string; label: string }>();
    for (const rawTag of tags) {
      const slug = slugifyTag(rawTag);
      if (!slug) {
        continue;
      }
      if (!normalizedMap.has(slug)) {
        normalizedMap.set(slug, {
          slug,
          label: titleizeTag(rawTag),
        });
      }
    }

    const normalizedTags = Array.from(normalizedMap.values());
    if (normalizedTags.length === 0) {
      return { skipped: false, count: 0 };
    }

    // D1 caps a statement at 100 bound parameters. The tag list comes straight
    // from the model, so it is unbounded — a photo that produced ~25 tags blew
    // the limit ("D1_ERROR: too many SQL variables") and failed the whole
    // upload workflow. Every statement below is per-tag-row, so all three are
    // chunked. 20 rows × 5 columns stays under 100.
    // ponytail: fixed chunk of 20, sized for the widest row here (5 cols); drop
    // it if D1 ever raises the variable cap.
    const TAG_CHUNK = 20;
    for (const batch of chunk(normalizedTags, TAG_CHUNK)) {
      await dbClient
        .insert(imageTags)
        .values(
          batch.map((tag) => ({
            slug: tag.slug,
            label: tag.label,
          })),
        )
        .onConflictDoNothing()
        .run();
    }

    const slugs = normalizedTags.map((tag) => tag.slug);
    const ensuredTags: (typeof imageTags.$inferSelect)[] = [];
    for (const batch of chunk(slugs, TAG_CHUNK)) {
      ensuredTags.push(
        ...(await dbClient.select().from(imageTags).where(inArray(imageTags.slug, batch)).all()),
      );
    }

    for (const batch of chunk(ensuredTags, TAG_CHUNK)) {
      await dbClient
        .insert(imageTagMappings)
        .values(
          batch.map((tagRow) => ({
            imageId,
            tagId: tagRow.id,
            source: "ai_prefill" as const,
            aiRationale: rationaleBySlug?.get(tagRow.slug) ?? null,
          })),
        )
        .onConflictDoNothing()
        .run();
    }

    return { skipped: false, count: ensuredTags.length };
  }

  // -------------------------------------------------------------------------
  // Multi-Modal Concatenated Vector Generation (Text Summary + Raw Image Features)
  // -------------------------------------------------------------------------

  /**
   * Core embedding generation function using cross-pooled model representations.
   */
  async generateEmbeddings(text: string): Promise<number[]> {
    // 1. Generate text embeddings from your summary string using BGE (768 dimensions)
    const textEmbeddingResponse = await this.ai.run(VECTOR_EMBED_MODEL as any, {
      text: [text],
    });
    const textVector = (
      textEmbeddingResponse as unknown as { data: number[][] }
    ).data[0];

    // 2. Generate text embeddings of the exact same summary text using Google Gemma (768 dimensions)
    // By cross-pooling two discrete model representations, we build an optimized multi-perspective vector space
    const structuralEmbeddingResponse = await this.ai.run(
      "@cf/google/embeddinggemma-300m" as any,
      {
        text: [text],
      },
    );
    const structureVector = (
      structuralEmbeddingResponse as unknown as { data: number[][] }
    ).data[0];

    // 3. Normalize both vectors independently before pooling to prevent dimensional dominance
    const normalize = (v: number[]) => {
      const mag = Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
      return mag === 0 ? v : v.map((val) => val / mag);
    };

    const normTextVector = normalize(textVector);
    const normStructureVector = normalize(structureVector);

    // 4. Concatenate vectors back-to-back: 768 + 768 = 1536 dimensions
    // This maps perfectly to Vectorize's top limits without data truncations.
    const concatenated = [...normTextVector, ...normStructureVector];

    // Explicit float allocation: Map to standard single-precision Float32Array to enforce single-precision floats
    return Array.from(new Float32Array(concatenated));
  }

  /**
   * Generates text summary embeddings using BGE, handles raw image features via a
   * localized visual embedding pass, normalizes both vectors, and joins them together
   * into a unified multi-modal index coordinate array.
   */
  async generateMultiModalEmbeddings(
    text: string,
    imageDataUrl: string,
  ): Promise<number[]> {
    return await this.generateEmbeddings(text);
  }

  async upsertEmbeddingVector(
    imageId: string,
    text: string,
    embeddings: number[],
  ): Promise<void> {
    await this.vectorIndex.upsert([
      {
        id: imageId,
        values: embeddings,
        metadata: { imageId, text },
      },
    ]);
  }

  async generateAndStoreEmbeddings(
    imageId: string,
    text: string,
    imageDataUrl: string,
  ): Promise<void> {
    const multiModalVector = await this.generateMultiModalEmbeddings(
      text,
      imageDataUrl,
    );
    await this.upsertEmbeddingVector(imageId, text, multiModalVector);
  }

  /**
   * Search images by semantic multi-modal similarity.
   */
  async searchImages(query: string, topK: number = 10) {
    // When executing query searches, pass the string across both layers to map into the identical concatenated layout space
    const textEmbeddingResponse = await this.ai.run(VECTOR_EMBED_MODEL as any, {
      text: [query],
    });
    const textVector = (
      textEmbeddingResponse as unknown as { data: number[][] }
    ).data[0];

    const structuralEmbeddingResponse = await this.ai.run(
      "@cf/google/embeddinggemma-300m" as any,
      {
        text: [query],
      },
    );
    const structureVector = (
      structuralEmbeddingResponse as unknown as { data: number[][] }
    ).data[0];

    const normalize = (v: number[]) => {
      const mag = Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
      return mag === 0 ? v : v.map((val) => val / mag);
    };

    const pooledQueryVector = [
      ...normalize(textVector),
      ...normalize(structureVector),
    ];

    // Explicit float allocation for strict standard single-precision mapping:
    const floatMappedVector = Array.from(new Float32Array(pooledQueryVector));

    return await this.vectorIndex.query(floatMappedVector, {
      topK,
      returnMetadata: "all",
    });
  }

  // -------------------------------------------------------------------------
  // Utility: Convert ArrayBuffer to base64 data URL
  // -------------------------------------------------------------------------

  static arrayBufferToDataUrl(
    arrayBuffer: ArrayBuffer,
    mimeType: string,
  ): string {
    const uint8Array = new Uint8Array(arrayBuffer);

    let binaryString = "";
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binaryString += String.fromCharCode(...chunk);
    }

    const base64Image = btoa(binaryString);
    return `data:${mimeType};base64,${base64Image}`;
  }

  // -------------------------------------------------------------------------
  // Full pipeline: process a single image (images table)
  // -------------------------------------------------------------------------

  async processImage(
    file: File,
    isListingPhoto: boolean = false,
    photoCategory?: string,
    options?: {
      uploadOptions?: CloudflareImagesUploadRequestOptions;
      roomAssignment?: ImageRoomAssignmentOptions;
      namingHints?: ImageNamingHints;
    },
  ): Promise<ProcessImageResult> {
    try {
      const imageId = crypto.randomUUID();
      const mimeType = file.type || "image/jpeg";
      const filename = file.name || "image.jpg";
      const filenameDisplayName = deriveDisplayName(filename);
      const normalizedCategory = normalizePhotoCategory(
        photoCategory,
        isListingPhoto,
      );
      const dbClient = drizzle(this.db);

      const arrayBuffer = await file.arrayBuffer();
      const uploadFingerprint = buildImageUploadFingerprintFromBytes({
        filename,
        sourceFileSize:
          Number.isFinite(file.size) && file.size > 0
            ? Math.trunc(file.size)
            : arrayBuffer.byteLength,
        bytes: arrayBuffer,
      });

      const imageBlob = new Blob([arrayBuffer], { type: mimeType });
      const dataUrl = ImageProcessorService.arrayBufferToDataUrl(
        arrayBuffer,
        mimeType,
      );

      const analysis = await this.analyzeImage(dataUrl, {
        photoCategory: normalizedCategory,
        roomHint: options?.roomAssignment?.roomType || null,
        roomLabels: options?.namingHints?.roomLabels || [],
        existingDisplayNames: options?.namingHints?.existingDisplayNames || [],
        referenceMetadata: options?.namingHints?.referenceMetadata || [],
      });
      const assignedRoomType =
        options?.roomAssignment?.roomType?.trim() ||
        analysis.roomType ||
        "unknown";
      const assignedRoomId =
        typeof options?.roomAssignment?.roomId === "number"
          ? options.roomAssignment.roomId
          : null;
      const roomLabel = toTitleCase(
        assignedRoomType.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(),
      );

      const roomContextDisplayNames = new Set<string>(
        (options?.namingHints?.existingDisplayNames || [])
          .map((value) => value.trim())
          .filter(Boolean),
      );
      if (
        roomContextDisplayNames.size === 0 &&
        normalizedCategory === "listing" &&
        assignedRoomId
      ) {
        const existingListingNames = await dbClient
          .select({
            displayName: images.displayName,
          })
          .from(images)
          .where(
            and(
              eq(images.photoCategory, "listing"),
              eq(images.roomId, assignedRoomId),
            ),
          )
          .all();
        for (const row of existingListingNames) {
          const value = row.displayName?.trim() || "";
          if (value) {
            roomContextDisplayNames.add(value);
          }
        }
      }

      const visibleSubject = analysis.visibleElements[0]?.trim() || "";
      const aiSuggestedName = sanitizeDisplayName(
        analysis.suggestedDisplayName || "",
      );
      const fallbackDisplayName = sanitizeDisplayName(
        visibleSubject && roomLabel
          ? `${roomLabel} ${visibleSubject}`
          : roomLabel
            ? `${roomLabel} photo`
            : filenameDisplayName,
      );
      const displayName = ensureUniqueDisplayName(
        aiSuggestedName || fallbackDisplayName || filenameDisplayName,
        Array.from(roomContextDisplayNames.values()),
      );

      const uploadResponse = await this.uploadToCloudflareImages(
        imageBlob,
        imageId,
        filename,
        options?.uploadOptions,
      );

      if (!uploadResponse.success) {
        throw new Error("Failed to upload original image");
      }

      const deliveryUrl = this.getDeliveryUrl(
        uploadResponse,
        uploadResponse.result.id,
      );
      const deliveryToken =
        ImageProcessorService.extractDeliveryTokenFromUrl(deliveryUrl) ||
        `${this.accountId}/${uploadResponse.result.id}`;

      let optimizedImageId: string | null = null;
      if (analysis.needsCrop && analysis.isInstagram) {
        optimizedImageId = deliveryToken;
      }

      const metadata = this.buildImageMetadata(analysis, {
        displayName,
        assignedRoomType,
        assignedRoomId,
        deliveryUrl,
        deliveryToken,
      });

      await dbClient.insert(images).values({
        id: imageId,
        displayName,
        cfImageIdOriginal: deliveryToken,
        cfImageIdOptimized: optimizedImageId,
        photoCategory: normalizedCategory,
        roomId: assignedRoomId,
        roomType: assignedRoomType,
        isInstagram: analysis.isInstagram,
        instagramAccount: analysis.instagramAccount,
        instagramCaption: analysis.instagramCaption,
        metadata: JSON.stringify({
          ...metadata,
          uploadFingerprint,
        }),
        isListingPhoto: normalizedCategory === "listing",
        sourceFilename: uploadFingerprint.sourceFilename,
        sourceFilenameNormalized: uploadFingerprint.sourceFilenameNormalized,
        sourceFileSize: uploadFingerprint.sourceFileSize,
        sourceFileMd5: uploadFingerprint.sourceFileMd5,
      });

      // Updated to utilize the multi-modal concatenated vector pipeline pass
      const embeddingText = `${analysis.roomType} ${analysis.keywords.join(" ")} ${analysis.instagramCaption || ""}`;
      try {
        await this.generateAndStoreEmbeddings(imageId, embeddingText, dataUrl);
      } catch (error) {
        console.warn(
          `[Vectorize] Failed to store multi-modal pooled embeddings for image ${imageId}; continuing without vector index.`,
          error,
        );
      }

      return { success: true, imageId, deliveryUrl, analysis };
    } catch (error) {
      console.error("Error processing image:", error);
      return {
        success: false,
        imageId: "",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // -------------------------------------------------------------------------
  // Full pipeline: process a photo review upload (image_reviews table)
  // -------------------------------------------------------------------------

  async processPhotoReview(
    file: File,
    options?: {
      uploadFingerprint?: ImageUploadFingerprint;
    },
  ): Promise<{
    success: boolean;
    record?: Record<string, unknown>;
    error?: string;
  }> {
    try {
      const id = crypto.randomUUID();
      const filename = file.name || "review.jpg";
      const mimeType = file.type || "image/jpeg";

      const arrayBuffer = await file.arrayBuffer();
      const uploadFingerprint =
        options?.uploadFingerprint ||
        buildImageUploadFingerprintFromBytes({
          filename,
          sourceFileSize:
            Number.isFinite(file.size) && file.size > 0
              ? Math.trunc(file.size)
              : arrayBuffer.byteLength,
          bytes: arrayBuffer,
        });

      const imageBlob = new Blob([arrayBuffer], { type: mimeType });
      const dataUrl = ImageProcessorService.arrayBufferToDataUrl(
        arrayBuffer,
        mimeType,
      );

      const uploadResponse = await this.uploadToCloudflareImages(
        imageBlob,
        id,
        filename,
      );
      if (!uploadResponse.success) {
        throw new Error("Failed to upload to Cloudflare Images");
      }

      const deliveryUrl = this.getDeliveryUrl(
        uploadResponse,
        uploadResponse.result.id,
      );
      const deliveryToken =
        ImageProcessorService.extractDeliveryTokenFromUrl(deliveryUrl) ||
        `${this.accountId}/${uploadResponse.result.id}`;

      const analysis = await this.analyzePhotoReview(dataUrl);
      const roomLabel = toTitleCase(analysis.room || "Inspiration");
      const primaryTag = analysis.tags[0] ? toTitleCase(analysis.tags[0]) : "";
      const displayName = ensureUniqueDisplayName(
        sanitizeDisplayName(
          primaryTag
            ? `${roomLabel} ${primaryTag}`
            : `${roomLabel} inspiration`,
        ),
        [],
      );

      const db = drizzle(this.db);
      const newRecord = {
        id,
        path: deliveryUrl,
        filename: uploadFingerprint.sourceFilename,
        room: analysis.room,
        tags: analysis.tags,
        sourceFilenameNormalized: uploadFingerprint.sourceFilenameNormalized,
        sourceFileSize: uploadFingerprint.sourceFileSize,
        sourceFileMd5: uploadFingerprint.sourceFileMd5,
        updatedAt: new Date(),
      };

      await db.insert(imageReviews).values(newRecord).run();

      await db
        .insert(images)
        .values({
          id,
          displayName,
          cfImageIdOriginal: deliveryToken,
          cfImageIdOptimized: null,
          photoCategory: "inspirational",
          roomType: analysis.room,
          isInstagram: false,
          metadata: JSON.stringify({
            source: "photo-review",
            tags: analysis.tags,
            uploadFingerprint,
            aiPrefill: {
              tags: analysis.tags.map((tag) => ({
                value: tag,
                rationale:
                  "Selected by Workers AI from visual features in this inspiration image.",
              })),
              note: {
                value: "",
                rationale:
                  "No note was generated automatically for this upload; reviewer input is expected.",
              },
              roomType: {
                value: analysis.room,
                rationale:
                  "Workers AI inferred room type from dominant fixtures and spatial cues.",
              },
              displayName: {
                value: displayName,
                rationale:
                  "Generated from room + leading style tag to provide a scannable review label.",
              },
            },
            deliveryUrl,
            deliveryToken,
          }),
          isListingPhoto: false,
          sourceFilename: uploadFingerprint.sourceFilename,
          sourceFilenameNormalized: uploadFingerprint.sourceFilenameNormalized,
          sourceFileSize: uploadFingerprint.sourceFileSize,
          sourceFileMd5: uploadFingerprint.sourceFileMd5,
        })
        .run();

      // Updated review pipeline index execution path
      const embeddingText = `${analysis.room} ${analysis.tags.join(" ")}`;
      try {
        await this.generateAndStoreEmbeddings(id, embeddingText, dataUrl);
      } catch (error) {
        console.warn(
          `[Vectorize] Failed to store review multi-modal pooled embeddings for image ${id}; continuing without vector index.`,
          error,
        );
      }

      return { success: true, record: newRecord };
    } catch (error) {
      console.error("Photo review processing error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // -------------------------------------------------------------------------
  // Bulk processing
  // -------------------------------------------------------------------------

  async processBulkImages(
    files: File[],
    isListingPhoto: boolean = false,
    photoCategory?: string,
    options?: {
      roomAssignment?: ImageRoomAssignmentOptions;
      namingHints?: ImageNamingHints;
    },
  ): Promise<ProcessImageResult[]> {
    const results: ProcessImageResult[] = [];
    const batchToken = await this.createImagesBatchToken();
    const batchUploadOptions: CloudflareImagesUploadRequestOptions | undefined =
      batchToken
        ? {
            endpoint: "https://batch.imagedelivery.net/images/v1",
            authTokenOverride: batchToken,
            maxAttempts: 2,
          }
        : undefined;

    for (const file of files) {
      let result = await this.processImage(
        file,
        isListingPhoto,
        photoCategory,
        {
          uploadOptions: batchUploadOptions,
          roomAssignment: options?.roomAssignment,
          namingHints: options?.namingHints,
        },
      );

      if (batchUploadOptions && !result.success) {
        console.warn(
          "[Images API] Batch upload failed for one file, retrying via standard endpoint.",
        );
        result = await this.processImage(file, isListingPhoto, photoCategory, {
          roomAssignment: options?.roomAssignment,
          namingHints: options?.namingHints,
        });
      }

      results.push(result);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return results;
  }
}
