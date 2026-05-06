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

import { drizzle } from "drizzle-orm/d1";
import { images, imageReviews } from "@backend/db";
import { WorkersAIProvider } from "@backend/ai/providers/workers-ai";
import { modelRegistry } from "@backend/ai/models/index";

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
        description: "The room or area type, e.g. kitchen, bathroom, living room, bedroom, backyard, exterior, hallway, office",
      },
      keywords: {
        type: "array",
        items: { type: "string" },
        description: "5-10 keywords describing style, materials, colors, and features",
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
    required: ["roomType", "keywords", "isInstagram", "instagramAccount", "instagramCaption"],
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
        description: "The room or area type in lowercase, e.g. kitchen, bathroom, living room, bedroom, backyard",
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImageAnalysisResult {
  roomType: string;
  keywords: string[];
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

export interface ProcessImageResult {
  success: boolean;
  imageId: string;
  deliveryUrl?: string;
  analysis?: ImageAnalysisResult;
  error?: string;
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

  constructor(
    env: Env,
    accountId: string,
    apiToken: string,
  ) {
    this.provider = new WorkersAIProvider(env);
    this.ai = env.AI;
    this.vectorIndex = env.VECTOR_INDEX;
    this.db = env.DB;
    this.accountId = accountId;
    this.apiToken = apiToken;
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
  async analyzeImage(imageDataUrl: string): Promise<ImageAnalysisResult> {
    // Step 1: Get raw description from vision model
    const visionDescription = await this.describeImage(imageDataUrl);

    // Step 2: Pass description to gpt-oss-120b with json_schema for structured extraction
    const structured = (await this.provider.invokeStructured(modelRegistry.extract, {
      messages: [
        {
          role: "system",
          content: `You are an expert interior design analyst. Extract structured metadata from the provided image description. Always respond with valid JSON matching the schema.`,
        },
        {
          role: "user",
          content: `Analyze the following image description and extract structured metadata:\n\n${visionDescription}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: IMAGE_ANALYSIS_SCHEMA,
      },
    })) as {
      roomType: string;
      keywords: string[];
      isInstagram: boolean;
      instagramAccount: string | null;
      instagramCaption: string | null;
    };

    return {
      roomType: structured.roomType || "unknown",
      keywords: Array.isArray(structured.keywords) ? structured.keywords : [],
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

  /**
   * Upload an image to Cloudflare Images and return the API response.
   * Implements exponential backoff to handle transient 429s.
   */
  async uploadToCloudflareImages(
    imageBlob: Blob,
    customId?: string,
    filename?: string
  ): Promise<CloudflareImagesResponse> {
    const formData = new FormData();
    formData.append("file", imageBlob, filename || "image.jpg");

    if (customId) {
      formData.append("id", customId);
    }

    const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v1`;
    let lastErrorText = "";

    // 3 Retry loop to weather 429s and 5xx
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
        },
        body: formData,
      });

      if (response.ok) {
        return await response.json();
      }

      const errorText = await response.text();
      lastErrorText = errorText;

      // Retry on 429 Too Many Requests or 5xx Server Errors
      if (response.status === 429 || response.status >= 500) {
        console.warn(`[Images API] ${response.status} Error (Attempt ${attempt}/3):`, errorText);
        if (attempt < 3) {
          // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
          continue;
        }
      }

      // 4xx bad requests hit this immediately
      throw new Error(`Failed to upload to Cloudflare Images (${response.status}): ${errorText}`);
    }

    throw new Error(`Failed to upload to Cloudflare Images after 3 attempts. Last error: ${lastErrorText}`);
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
    const embeddingResponse = await this.ai.run(modelRegistry.embed.id as any, {
      text: [text],
    });

    const embeddings = (embeddingResponse as { data: number[][] }).data[0];

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
    const queryEmbedding = await this.ai.run("@cf/baai/bge-base-en-v1.5", {
      text: [query],
    });

    const embeddings = (queryEmbedding as { data: number[][] }).data[0];

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
  ): Promise<ProcessImageResult> {
    try {
      const imageId = crypto.randomUUID();
      const mimeType = file.type || "image/jpeg";
      const filename = file.name || "image.jpg";

      // CRITICAL FIX: Extract stream exactly ONCE
      const arrayBuffer = await file.arrayBuffer();

      // Reconstruct fresh payload for APIs to avoid stream consumption 400/429s
      const imageBlob = new Blob([arrayBuffer], { type: mimeType });
      const dataUrl = ImageProcessorService.arrayBufferToDataUrl(arrayBuffer, mimeType);

      // Step 1: Analyze image with vision → structured reasoning
      const analysis = await this.analyzeImage(dataUrl);

      // Step 2: Upload to Cloudflare Images
      const uploadResponse = await this.uploadToCloudflareImages(imageBlob, imageId, filename);

      if (!uploadResponse.success) {
        throw new Error("Failed to upload original image");
      }

      const deliveryUrl = this.getDeliveryUrl(uploadResponse, imageId);

      let optimizedImageId: string | null = null;
      if (analysis.needsCrop && analysis.isInstagram) {
        optimizedImageId = uploadResponse.result.id;
      }

      // Step 3: Store in D1
      const dbClient = drizzle(this.db);
      const metadata = {
        keywords: analysis.keywords,
        aiAnalysis: {
          roomType: analysis.roomType,
          isInstagram: analysis.isInstagram,
        },
      };

      await dbClient.insert(images).values({
        id: imageId,
        cfImageIdOriginal: uploadResponse.result.id,
        cfImageIdOptimized: optimizedImageId,
        roomType: analysis.roomType,
        isInstagram: analysis.isInstagram,
        instagramAccount: analysis.instagramAccount,
        instagramCaption: analysis.instagramCaption,
        metadata: JSON.stringify(metadata),
        isListingPhoto,
      });

      // Step 4: Generate embeddings
      const embeddingText = `${analysis.roomType} ${analysis.keywords.join(" ")} ${analysis.instagramCaption || ""}`;
      await this.generateAndStoreEmbeddings(imageId, embeddingText);

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

      // Step 2: Analyze with vision → structured reasoning
      const analysis = await this.analyzePhotoReview(dataUrl);

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
  ): Promise<ProcessImageResult[]> {
    const results: ProcessImageResult[] = [];
    
    // CRITICAL FIX: Evaluate iteratively, not via Promise.all()
    // Resolving concurrently immediately trips the Cloudflare REST API 429 threshold
    for (const file of files) {
      const result = await this.processImage(file, isListingPhoto);
      results.push(result);
      // Brief pause between uploads to allow edge tokens to refill
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    
    return results;
  }
}
