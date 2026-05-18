/**
 * @fileoverview Image processing service with AI analysis and Cloudflare Images integration
 *
 * This service handles:
 * - Single and bulk image uploads to Cloudflare Images
 * - Workers AI vision analysis via llama-3.2-11b-vision (room detection, Instagram UI detection)
 * - Structured reasoning via gpt-oss-120b with json_schema (tag enrichment, metadata extraction)
 * - Vectorize embedding generation and semantic search
 *
 * Model strategy:
 * Vision: @cf/meta/llama-3.2-11b-vision-instruct (multimodal analysis)
 * Reasoning: @cf/openai/gpt-oss-120b with response_format json_schema (structured output)
 * Embeddings: @cf/baai/bge-base-en-v1.5
 */

import { modelRegistry } from "@backend/ai/models/index";
import { WorkersAIProvider } from "@backend/ai/providers/workers-ai";
import { images, imageReviews } from "@backend/db";
import { GoogleGenAI } from "@google/genai";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

// ---------------------------------------------------------------------------
// JSON Schemas for structured output (gpt-oss-120b json_schema mode)
// ---------------------------------------------------------------------------

/**
 * JSON Schema that gpt-oss-120b uses via response_format: { type: "json_schema" }
 * to return deterministic, parseable structured data.
 */
const IMAGE_ANALYSIS_SCHEMA = {
  name: "image_analysis",
  strict: true,
  schema: {
    type: "object",
    properties: {
      roomType: {
        type: "string",
        description:
          "The room or area type, e.g. kitchen, bathroom, living room, bedroom, backyard, exterior, hallway, office",
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "5-10 keywords describing style, materials, colors, and features",
      },
      suggestedDisplayName: {
        type: "string",
        description: "Short user-facing image label under 8 words, unique enough for room context",
      },
      styleTheme: {
        type: "string",
        description: "Design style summary, e.g. warm modern, moody contemporary, coastal minimal",
      },
      materials: {
        type: "array",
        items: { type: "string" },
        description: "Visible material references such as white oak, marble, brass, plaster",
      },
      visibleElements: {
        type: "array",
        items: { type: "string" },
        description:
          "Major visible elements or focal zones such as sink wall, vanity, island, shower, window",
      },
      isInstagram: {
        type: "boolean",
        description: "Whether the image appears to be an Instagram screenshot with UI elements",
      },
      instagramAccount: {
        type: ["string", "null"],
        description: "Instagram account handle if detected, null otherwise",
      },
      instagramCaption: {
        type: ["string", "null"],
        description: "Instagram caption text if detected, null otherwise",
      },
    },
    required: [
      "roomType",
      "keywords",
      "suggestedDisplayName",
      "styleTheme",
      "materials",
      "visibleElements",
      "isInstagram",
      "instagramAccount",
      "instagramCaption",
    ],
    additionalProperties: false,
  },
} as const;

const PHOTO_REVIEW_SCHEMA = {
  name: "photo_review_analysis",
  strict: true,
  schema: {
    type: "object",
    properties: {
      room: {
        type: "string",
        description:
          "The room or area type in lowercase, e.g. kitchen, bathroom, living room, bedroom, backyard",
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "5-10 lowercase tags describing styles, materials, colors, and features",
      },
    },
    required: ["room", "tags"],
    additionalProperties: false,
  },
} as const;

const VECTOR_EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageAnalysisResult {
  roomType: string;
  keywords: string[];
  suggestedDisplayName: string;
  styleTheme: string;
  materials: string[];
  visibleElements: string[];
  isInstagram: boolean;
  instagramAccount?: string;
  instagramCaption?: string;
  needsCrop: boolean;
}

export interface PhotoReviewAnalysis {
  room: string;
  tags: string[];
}

export interface CloudflareImagesResponse {
  result: {
    id: string;
    filename: string;
    uploaded: string;
    requireSignedURLs: boolean;
    variants: string[];
  };
  success: boolean;
  errors: unknown[];
  messages: unknown[];
}

export interface CloudflareImagesUploadRequestOptions {
  endpoint?: string;
  authTokenOverride?: string;
  maxAttempts?: number;
}

export interface ImageRoomAssignmentOptions {
  roomId?: number | null;
  roomType?: string | null;
}

export interface ImageNamingHints {
  roomLabels?: string[];
  existingDisplayNames?: string[];
  referenceMetadata?: string[];
}

export interface ProcessImageResult {
  success: boolean;
  imageId: string;
  deliveryUrl?: string;
  analysis?: ImageAnalysisResult;
  error?: string;
}

export type PhotoCategory = "inspirational" | "listing" | "ai_render";

function normalizePhotoCategory(
  category: string | null | undefined,
  isListingPhoto: boolean,
): PhotoCategory {
  if (category === "listing" || category === "ai_render" || category === "inspirational") {
    return category;
  }
  return isListingPhoto ? "listing" : "inspirational";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function deriveDisplayName(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) {
    return "Untitled photo";
  }
  return trimmed.replace(/\.[^./\\]+$/, "");
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return "";
      return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
    })
    .join(" ")
    .trim();
}

function sanitizeDisplayName(value: string): string {
  return value
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\-()' ]/gu, "")
    .trim()
    .slice(0, 80);
}

function ensureUniqueDisplayName(name: string, existingNames: string[]): string {
  const normalized = sanitizeDisplayName(name);
  const base = normalized || "Untitled photo";
  const existing = new Set(
    existingNames.map((entry) => entry.trim().toLowerCase()).filter((entry) => entry.length > 0),
  );

  if (!existing.has(base.toLowerCase())) {
    return base;
  }

  let suffix = 2;
  while (existing.has(`${base.toLowerCase()} ${suffix}`)) {
    suffix += 1;
  }
  return `${base} ${suffix}`;
}

function normalizeTagValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 48);
}

function buildAiPrefillPayload(
  analysis: ImageAnalysisResult,
  displayName: string,
  assignedRoomType: string,
) {
  const dedupedTags = Array.from(
    new Set(
      analysis.keywords
        .map((keyword) => normalizeTagValue(keyword))
        .filter((keyword) => keyword.length > 1),
    ),
  ).slice(0, 12);

  const contextParts = [
    analysis.styleTheme ? `style theme ${analysis.styleTheme}` : null,
    analysis.materials.length > 0 ? `materials ${analysis.materials.slice(0, 3).join(", ")}` : null,
    analysis.visibleElements.length > 0
      ? `visible elements ${analysis.visibleElements.slice(0, 3).join(", ")}`
      : null,
  ].filter(Boolean);

  const baseContext =
    contextParts.length > 0
      ? contextParts.join("; ")
      : "the visual composition and finishes detected in the photo";

  const tags = dedupedTags.map((tag) => ({
    value: tag,
    rationale: `Selected from Workers AI visual analysis based on ${baseContext}.`,
  }));

  const noteValue = [
    analysis.styleTheme ? `Theme: ${analysis.styleTheme}` : null,
    analysis.materials.length > 0
      ? `Materials: ${analysis.materials.slice(0, 4).join(", ")}`
      : null,
    analysis.visibleElements.length > 0
      ? `Focus: ${analysis.visibleElements.slice(0, 4).join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join(" • ");

  return {
    tags,
    note: {
      value: noteValue,
      rationale: "Generated from Workers AI visual summary to speed up review coding.",
    },
    roomType: {
      value: assignedRoomType,
      rationale: "Predicted from visual layout and room-defining elements in the image.",
    },
    displayName: {
      value: displayName,
      rationale: "Suggested from room context and focal elements to provide a unique review label.",
    },
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ImageProcessorService {
  private provider: WorkersAIProvider;
  private ai: Ai;
  private vectorIndex: VectorizeIndex;
  private db: D1Database;
  private accountId: string;
  private apiToken: string;
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
    this.vectorIndex = env.VECTOR_INDEX;
    this.db = env.DB;
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.apiTokens = Array.from(
      new Set(
        [apiToken, ...(options?.fallbackApiTokens || [])]
          .map((token) => token.trim())
          .filter((token) => token.length > 0),
      ),
    );
  }

  private static getDeliveryTokenFromUrl(deliveryUrl: string): string | null {
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

  // -------------------------------------------------------------------------
  // Vision analysis — llama-3.2-11b-vision-instruct
  // -------------------------------------------------------------------------

  /**
   * Analyze an image with the vision model to extract a raw text description.
   * The vision model doesn't support json_schema, so we get free-text back.
   */
  async describeImage(imageDataUrl: string): Promise<string> {
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
              image_url: { url: imageDataUrl },
            },
          ],
        },
      ],
      max_tokens: 1024,
    });

    return result.response;
  }

  // -------------------------------------------------------------------------
  // Structured reasoning — gpt-oss-120b with json_schema
  // -------------------------------------------------------------------------

  /**
   * Parse a vision model's free-text description into structured data using
   * gpt-oss-120b with response_format: { type: "json_schema" }.
   *
   * This ensures deterministic JSON output without regex hacks.
   */
  async analyzeImage(
    imageDataUrl: string,
    options?: {
      photoCategory?: PhotoCategory;
      roomHint?: string | null;
      roomLabels?: string[];
      existingDisplayNames?: string[];
      referenceMetadata?: string[];
    },
  ): Promise<ImageAnalysisResult> {
    // Step 1: Get raw description from vision model
    const visionDescription = await this.describeImage(imageDataUrl);
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

    // Step 2: Pass description to gpt-oss-120b with json_schema for structured extraction
    const structured = (await this.provider.invokeStructured(modelRegistry.extract, {
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
    })) as {
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
        typeof structured.suggestedDisplayName === "string" ? structured.suggestedDisplayName : "",
      styleTheme: typeof structured.styleTheme === "string" ? structured.styleTheme : "",
      materials: Array.isArray(structured.materials)
        ? structured.materials.map((item) => String(item).trim()).filter(Boolean)
        : [],
      visibleElements: Array.isArray(structured.visibleElements)
        ? structured.visibleElements.map((item) => String(item).trim()).filter(Boolean)
        : [],
      isInstagram: structured.isInstagram || false,
      instagramAccount: structured.instagramAccount || undefined,
      instagramCaption: structured.instagramCaption || undefined,
      needsCrop: structured.isInstagram || false,
    };
  }

  /**
   * Lightweight analysis for photo-reviews: returns room + tags only.
   * Uses vision → structured reasoning pipeline.
   */
  async analyzePhotoReview(imageDataUrl: string): Promise<PhotoReviewAnalysis> {
    // Step 1: Vision description
    const visionDescription = await this.describeImage(imageDataUrl);

    // Step 2: Structured extraction with json_schema
    const structured = (await this.provider.invokeStructured(modelRegistry.extract, {
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
    })) as { room: string; tags: string[] };

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
   * Upload an image to Cloudflare Images and return the API response.
   * Implements exponential backoff to handle transient 429s.
   */
  async uploadToCloudflareImages(
    imageBlob: Blob,
    customId?: string,
    filename?: string,
    options?: CloudflareImagesUploadRequestOptions,
  ): Promise<CloudflareImagesResponse> {
    const apiUrl =
      options?.endpoint ||
      `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v1`;
    const tokens = options?.authTokenOverride ? [options.authTokenOverride] : this.apiTokens;
    const maxAttempts = Math.max(1, options?.maxAttempts ?? 3);
    let lastError: Error | null = null;

    for (const token of tokens) {
      let lastErrorText = "";
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const formData = new FormData();
        formData.append("file", imageBlob, filename || "image.jpg");
        // Cloudflare Images rejects UUID values for Custom ID (error 5411).
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
          return await response.json();
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
   * Get the delivery URL from a Cloudflare Images upload response.
   */
  getDeliveryUrl(uploadResponse: CloudflareImagesResponse, fallbackId: string): string {
    if (uploadResponse.result.variants && uploadResponse.result.variants.length > 0) {
      return uploadResponse.result.variants[0];
    }
    return `https://imagedelivery.net/${this.accountId}/${fallbackId}/public`;
  }

  // -------------------------------------------------------------------------
  // Embeddings — Vectorize
  // -------------------------------------------------------------------------

  /**
   * Generate and store vector embeddings for semantic search.
   */
  async generateAndStoreEmbeddings(imageId: string, text: string): Promise<void> {
    const embeddingResponse = await this.ai.run(VECTOR_EMBED_MODEL as any, {
      text: [text],
    });

    const embeddings = (embeddingResponse as unknown as { data: number[][] }).data[0];

    await this.vectorIndex.upsert([
      {
        id: imageId,
        values: embeddings,
        metadata: { imageId, text },
      },
    ]);
  }

  /**
   * Search images by semantic similarity.
   */
  async searchImages(query: string, topK: number = 10) {
    const queryEmbedding = await this.ai.run(VECTOR_EMBED_MODEL as any, {
      text: [query],
    });

    const embeddings = (queryEmbedding as unknown as { data: number[][] }).data[0];

    return await this.vectorIndex.query(embeddings, {
      topK,
      returnMetadata: "all",
    });
  }

  // -------------------------------------------------------------------------
  // Utility: Convert ArrayBuffer to base64 data URL
  // -------------------------------------------------------------------------

  static arrayBufferToDataUrl(arrayBuffer: ArrayBuffer, mimeType: string): string {
    const uint8Array = new Uint8Array(arrayBuffer);

    // Convert to base64 in chunks to avoid stack overflow for large images
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
      const normalizedCategory = normalizePhotoCategory(photoCategory, isListingPhoto);
      const dbClient = drizzle(this.db);

      // CRITICAL FIX: Extract stream exactly ONCE
      const arrayBuffer = await file.arrayBuffer();

      // Reconstruct fresh payload for APIs to avoid stream consumption 400/429s
      const imageBlob = new Blob([arrayBuffer], { type: mimeType });
      const dataUrl = ImageProcessorService.arrayBufferToDataUrl(arrayBuffer, mimeType);

      // Step 1: Analyze image with vision → structured reasoning
      const analysis = await this.analyzeImage(dataUrl, {
        photoCategory: normalizedCategory,
        roomHint: options?.roomAssignment?.roomType || null,
        roomLabels: options?.namingHints?.roomLabels || [],
        existingDisplayNames: options?.namingHints?.existingDisplayNames || [],
        referenceMetadata: options?.namingHints?.referenceMetadata || [],
      });
      const assignedRoomType =
        options?.roomAssignment?.roomType?.trim() || analysis.roomType || "unknown";
      const assignedRoomId =
        typeof options?.roomAssignment?.roomId === "number" ? options.roomAssignment.roomId : null;
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
          .where(and(eq(images.photoCategory, "listing"), eq(images.roomId, assignedRoomId)))
          .all();
        for (const row of existingListingNames) {
          const value = row.displayName?.trim() || "";
          if (value) {
            roomContextDisplayNames.add(value);
          }
        }
      }

      const visibleSubject = analysis.visibleElements[0]?.trim() || "";
      const aiSuggestedName = sanitizeDisplayName(analysis.suggestedDisplayName || "");
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

      // Step 2: Upload to Cloudflare Images
      const uploadResponse = await this.uploadToCloudflareImages(
        imageBlob,
        imageId,
        filename,
        options?.uploadOptions,
      );

      if (!uploadResponse.success) {
        throw new Error("Failed to upload original image");
      }

      const deliveryUrl = this.getDeliveryUrl(uploadResponse, imageId);
      const deliveryToken =
        ImageProcessorService.getDeliveryTokenFromUrl(deliveryUrl) ||
        `${this.accountId}/${uploadResponse.result.id}`;

      let optimizedImageId: string | null = null;
      if (analysis.needsCrop && analysis.isInstagram) {
        optimizedImageId = deliveryToken;
      }

      const aiPrefill = buildAiPrefillPayload(analysis, displayName, assignedRoomType);

      // Step 3: Store in D1
      const metadata = {
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
        assignedRoomType,
        assignedRoomId,
        deliveryUrl,
        deliveryToken,
      };

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
        metadata: JSON.stringify(metadata),
        isListingPhoto: normalizedCategory === "listing",
      });

      // Step 4: Generate embeddings
      const embeddingText = `${analysis.roomType} ${analysis.keywords.join(" ")} ${analysis.instagramCaption || ""}`;
      try {
        await this.generateAndStoreEmbeddings(imageId, embeddingText);
      } catch (error) {
        console.warn(
          `[Vectorize] Failed to store embeddings for image ${imageId}; continuing without vector index.`,
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
  ): Promise<{ success: boolean; record?: Record<string, unknown>; error?: string }> {
    try {
      const id = crypto.randomUUID();
      const filename = file.name || "review.jpg";
      const mimeType = file.type || "image/jpeg";

      // CRITICAL FIX: Extract stream exactly ONCE
      const arrayBuffer = await file.arrayBuffer();

      // Reconstruct fresh payload for APIs to avoid stream consumption 400/429s
      const imageBlob = new Blob([arrayBuffer], { type: mimeType });
      const dataUrl = ImageProcessorService.arrayBufferToDataUrl(arrayBuffer, mimeType);

      // Step 1: Upload to Cloudflare Images
      const uploadResponse = await this.uploadToCloudflareImages(imageBlob, id, filename);
      if (!uploadResponse.success) {
        throw new Error("Failed to upload to Cloudflare Images");
      }

      const deliveryUrl = this.getDeliveryUrl(uploadResponse, id);
      const deliveryToken =
        ImageProcessorService.getDeliveryTokenFromUrl(deliveryUrl) ||
        `${this.accountId}/${uploadResponse.result.id}`;

      // Step 2: Analyze with vision → structured reasoning
      const analysis = await this.analyzePhotoReview(dataUrl);
      const roomLabel = toTitleCase(analysis.room || "Inspiration");
      const primaryTag = analysis.tags[0] ? toTitleCase(analysis.tags[0]) : "";
      const displayName = ensureUniqueDisplayName(
        sanitizeDisplayName(primaryTag ? `${roomLabel} ${primaryTag}` : `${roomLabel} inspiration`),
        [],
      );

      // Step 3: Save to D1
      const db = drizzle(this.db);
      const newRecord = {
        id,
        path: deliveryUrl,
        filename,
        room: analysis.room,
        tags: analysis.tags,
        updatedAt: new Date(),
      };

      await db.insert(imageReviews).values(newRecord).run();

      // Keep the main gallery in sync with review uploads.
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
            aiPrefill: {
              tags: analysis.tags.map((tag) => ({
                value: tag,
                rationale: "Selected by Workers AI from visual features in this inspiration image.",
              })),
              note: {
                value: "",
                rationale:
                  "No note was generated automatically for this upload; reviewer input is expected.",
              },
              roomType: {
                value: analysis.room,
                rationale: "Workers AI inferred room type from dominant fixtures and spatial cues.",
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
        })
        .run();

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
    const batchUploadOptions: CloudflareImagesUploadRequestOptions | undefined = batchToken
      ? {
          endpoint: "https://batch.imagedelivery.net/images/v1",
          authTokenOverride: batchToken,
          maxAttempts: 2,
        }
      : undefined;

    // CRITICAL FIX: Evaluate iteratively, not via Promise.all()
    // Resolving concurrently immediately trips the Cloudflare REST API 429 threshold
    for (const file of files) {
      let result = await this.processImage(file, isListingPhoto, photoCategory, {
        uploadOptions: batchUploadOptions,
        roomAssignment: options?.roomAssignment,
        namingHints: options?.namingHints,
      });

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
      // Brief pause between uploads to allow edge tokens to refill
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return results;
  }
}

export async function processImageEdit(
  env: Env,
  prompt: string,
  base64Images: { data: string; mimeType: string }[],
): Promise<string | null> {
  const geminiApiKey = await env.GEMINI_API_KEY.get();
  const cloudflareAccountId = await env.CLOUDFLARE_ACCOUNT_ID.get();

  if (!geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  if (!cloudflareAccountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured");
  }

  const ai = new GoogleGenAI({
    apiKey: geminiApiKey,
    httpOptions: {
      baseUrl: `https://gateway.ai.cloudflare.com/v1/${cloudflareAccountId}/${env.AI_GATEWAY_ID}/google-ai-studio`,
    },
  });

  // Assemble the multi-modal input payload.
  // First item is the prompt, followed by the base image and up to 13 inspiration/reference images.
  const input = [
    { type: "text", text: prompt },
    ...base64Images.map((img) => ({
      type: "image",
      mime_type: img.mimeType,
      data: img.data,
    })),
  ];

  const interaction = await (ai as any).interactions.create({
    model: "gemini-3-pro-image-preview",
    input: input as any,
    response_format: {
      type: "image",
      image_size: "4K", // Forcing maximum professional fidelity
    },
  });

  for (const step of interaction.steps as Array<any>) {
    if (step.type === "model_output") {
      for (const contentBlock of step.content as Array<any>) {
        if (contentBlock.type === "image") {
          // Returning the raw base64 string directly for Cloudflare Images upload
          return contentBlock.data as string;
        }
      }
    }
  }

  return null;
}
