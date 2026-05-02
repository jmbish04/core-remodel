/**
 * @fileoverview Image processing service with AI analysis and Cloudflare Images integration
 *
 * This service handles:
 * - Bulk image uploads
 * - Workers AI vision analysis (room detection, Instagram UI detection)
 * - Cloudflare Images upload (original + optimized)
 * - Vectorize embedding generation and storage
 */

import type { Ai, VectorizeIndex, D1Database } from '@cloudflare/workers-types';
import { drizzle } from 'drizzle-orm/d1';
import { images } from '../db/schema';
import { randomUUID } from 'node:crypto';

interface ImageAnalysisResult {
  roomType: string;
  keywords: string[];
  isInstagram: boolean;
  instagramAccount?: string;
  instagramCaption?: string;
  needsCrop: boolean;
}

interface CloudflareImagesResponse {
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

export class ImageProcessorService {
  private ai: Ai;
  private vectorIndex: VectorizeIndex;
  private db: D1Database;
  private accountId: string;
  private apiToken: string;

  constructor(
    ai: Ai,
    vectorIndex: VectorizeIndex,
    db: D1Database,
    accountId: string,
    apiToken: string
  ) {
    this.ai = ai;
    this.vectorIndex = vectorIndex;
    this.db = db;
    this.accountId = accountId;
    this.apiToken = apiToken;
  }

  /**
   * Analyze image using Workers AI Llama Vision model
   */
  private async analyzeImage(imageBlob: Blob): Promise<ImageAnalysisResult> {
    // Convert blob to base64 for AI model
    const arrayBuffer = await imageBlob.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Convert to base64 in chunks to avoid stack overflow for large images
    let binaryString = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binaryString += String.fromCharCode(...chunk);
    }
    const base64Image = btoa(binaryString);
    const dataUrl = `data:${imageBlob.type};base64,${base64Image}`;

    // Use Llama Vision to analyze the image
    const analysisPrompt = `Analyze this image and provide:
1. Room type (e.g., kitchen, bathroom, living room, bedroom, backyard, exterior)
2. 5-10 relevant keywords describing the style, colors, and features
3. Whether this is an Instagram screenshot (look for UI elements like username, likes, comments)
4. If Instagram: extract the account handle and caption text

Respond in JSON format:
{
  "roomType": "string",
  "keywords": ["string"],
  "isInstagram": boolean,
  "instagramAccount": "string or null",
  "instagramCaption": "string or null"
}`;

    const aiResponse = await this.ai.run('@cf/meta/llama-3.2-11b-vision-instruct', {
      messages: [
        {
          role: 'user',
          content: analysisPrompt,
        },
      ],
      image: [dataUrl],
    });

    // Parse AI response
    let analysis: ImageAnalysisResult;
    try {
      const responseText = (aiResponse as { response?: string }).response || JSON.stringify(aiResponse);
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as {
          roomType?: string;
          keywords?: string[];
          isInstagram?: boolean;
          instagramAccount?: string | null;
          instagramCaption?: string | null;
        };
        analysis = {
          roomType: parsed.roomType || 'unknown',
          keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
          isInstagram: parsed.isInstagram || false,
          instagramAccount: parsed.instagramAccount || undefined,
          instagramCaption: parsed.instagramCaption || undefined,
          needsCrop: parsed.isInstagram || false,
        };
      } else {
        // Fallback if parsing fails
        analysis = {
          roomType: 'unknown',
          keywords: [],
          isInstagram: false,
          needsCrop: false,
        };
      }
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      analysis = {
        roomType: 'unknown',
        keywords: [],
        isInstagram: false,
        needsCrop: false,
      };
    }

    return analysis;
  }

  /**
   * Upload image to Cloudflare Images
   */
  private async uploadToCloudflareImages(
    imageBlob: Blob,
    customId?: string
  ): Promise<CloudflareImagesResponse> {
    const formData = new FormData();
    formData.append('file', imageBlob);

    if (customId) {
      formData.append('id', customId);
    }

    const apiUrl = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/images/v1`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Failed to upload to Cloudflare Images: ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Generate and store vector embeddings
   */
  private async generateAndStoreEmbeddings(
    imageId: string,
    text: string
  ): Promise<void> {
    // Generate embedding from keywords and room type
    const embeddingResponse = await this.ai.run('@cf/baai/bge-base-en-v1.5', {
      text: [text],
    });

    const embeddings = (embeddingResponse as { data: number[][] }).data[0];

    // Upsert to Vectorize
    await this.vectorIndex.upsert([
      {
        id: imageId,
        values: embeddings,
        metadata: {
          imageId,
          text,
        },
      },
    ]);
  }

  /**
   * Process a single image through the full pipeline
   */
  async processImage(
    file: File,
    isListingPhoto: boolean = false
  ): Promise<{ success: boolean; imageId: string; error?: string }> {
    try {
      const imageId = randomUUID();

      // Step 1: Analyze image with AI
      const analysis = await this.analyzeImage(file);

      // Step 2: Upload original to Cloudflare Images
      const originalUpload = await this.uploadToCloudflareImages(file, imageId);

      if (!originalUpload.success) {
        throw new Error('Failed to upload original image');
      }

      let optimizedImageId: string | null = null;

      // Step 3: If Instagram, crop and upload optimized version
      if (analysis.needsCrop && analysis.isInstagram) {
        // For now, we'll skip the cropping logic and just store the original
        // In production, you'd use Cloudflare Images transformations or Workers AI
        // to detect and crop out the Instagram UI
        optimizedImageId = originalUpload.result.id;
      }

      // Step 4: Store in D1
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
        cfImageIdOriginal: originalUpload.result.id,
        cfImageIdOptimized: optimizedImageId,
        roomType: analysis.roomType,
        isInstagram: analysis.isInstagram,
        instagramAccount: analysis.instagramAccount,
        instagramCaption: analysis.instagramCaption,
        metadata: JSON.stringify(metadata),
        isListingPhoto,
      });

      // Step 5: Generate embeddings and store in Vectorize
      const embeddingText = `${analysis.roomType} ${analysis.keywords.join(' ')} ${analysis.instagramCaption || ''}`;
      await this.generateAndStoreEmbeddings(imageId, embeddingText);

      return {
        success: true,
        imageId,
      };
    } catch (error) {
      console.error('Error processing image:', error);
      return {
        success: false,
        imageId: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Process multiple images in bulk
   */
  async processBulkImages(
    files: File[],
    isListingPhoto: boolean = false
  ): Promise<Array<{ success: boolean; imageId: string; error?: string }>> {
    const results = await Promise.all(
      files.map((file) => this.processImage(file, isListingPhoto))
    );

    return results;
  }

  /**
   * Search images by semantic similarity
   */
  async searchImages(query: string, topK: number = 10) {
    // Generate embedding for query
    const queryEmbedding = await this.ai.run('@cf/baai/bge-base-en-v1.5', {
      text: [query],
    });

    const embeddings = (queryEmbedding as { data: number[][] }).data[0];

    // Query Vectorize
    const results = await this.vectorIndex.query(embeddings, {
      topK,
      returnMetadata: 'all',
    });

    return results;
  }
}
