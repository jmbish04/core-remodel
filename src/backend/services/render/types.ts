/**
 * Shared types for the staged virtual-staging render pipeline.
 * See docs/0004_ai_image_editing/IMPLEMENTATION_PLAN.md.
 */

export type ProviderName = "gemini" | "fal" | "replicate";

export type StageType =
  | "stage_0_LP_unfurnished"
  | "stage_1_LP_base"
  | "stage_2_LP_rough_in"
  | "stage_3_LP_finish"
  | "stage_5_LP_synthesis"
  | "stage_0_IP_extraction"
  | "stage_1_IP_finish";

export type LightingProfile = "default" | "day" | "night";

/** A reference image attached to a generation, scoped to material/form only. */
export interface ReferenceImage {
  /** Cloudflare Images delivery URL (NOT base64). */
  url: string;
  /** Short label, e.g. "island marble", "faucet". Used in the prompt. */
  label: string;
}

/** Normalized input handed to any StageProvider. */
export interface StageInput {
  /** The image being edited — a Cloudflare Images delivery URL. */
  inputImageUrl: string;
  /** Fully composed prompt (preservation block + request + guidelines). */
  prompt: string;
  /** Output framing — nearest supported ratio of the source, e.g. "3:2". */
  aspectRatio: string;
  /** Output resolution token, e.g. "2K". */
  imageSize?: string;
  /** Material/form-only reference images. */
  references?: ReferenceImage[];
  /** Optional inpainting mask — a Cloudflare Images delivery URL. */
  maskUrl?: string;
  /**
   * Ordered image URLs for multi-image synthesis (Stage 5). image_urls[0] is the
   * base/working canvas (@image1); the rest are inspiration refs (@image2..).
   */
  imageUrls?: string[];
  /** Optional explicit model slug/id override (else the registry default). */
  model?: string;
}

/**
 * Provider result. A provider returns EITHER raw bytes (Gemini inline data) OR a
 * URL (Fal/Replicate). The StageRunner normalizes both → uploads to Cloudflare Images.
 */
export interface StageOutput {
  imageBytes?: ArrayBuffer;
  imageUrl?: string;
  mimeType: string;
  /** The model/slug that actually produced the output. */
  model: string;
  provider: ProviderName;
  /** Provider raw response (stored in canvas metadata for debugging). */
  raw?: unknown;
}

/** Thrown for transient (429/5xx) provider faults so the failover layer can step down. */
export class TransientProviderError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TransientProviderError";
  }
}
