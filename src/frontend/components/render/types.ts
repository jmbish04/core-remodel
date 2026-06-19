// ---------------------------------------------------------------------------
// Shared types + helpers for the Renovation Studio render pipeline UI.
//
// These mirror the API contract documented in
// docs/0004_ai_image_editing/IMPLEMENTATION_PLAN.md (§7, §8, §10). The backend
// is built in parallel; these client-side shapes are the wire contract this
// surface codes against.
// ---------------------------------------------------------------------------

/** Stage taxonomy from §3 of the implementation plan (render_canvases.type). */
export type RenderCanvasType =
  | "stage_0_LP_unfurnished"
  | "stage_1_LP_base"
  | "stage_2_LP_rough_in"
  | "stage_3_LP_finish"
  | "stage_0_IP_extraction"
  | "stage_1_IP_finish"
  | "stage_5_LP_synthesis";

/** Coarse stage buckets surfaced in the timeline UI (stage_0..stage_3). */
export type StageBucket = "stage_0" | "stage_1" | "stage_2" | "stage_3";

export type LightingProfile = "default" | "day" | "night";

export type CanvasStatus = "pending" | "done" | "failed";

/** Action enum that drives stage routing on POST /api/render/stage. */
export type StageActionType =
  | "INITIAL_BASE"
  | "STRUCTURAL_MOVE"
  | "MATERIAL_TWEAK"
  | "FINISH";

/** A node in the render state-tree (render_canvases row, view-model subset). */
export interface RenderCanvas {
  id: string;
  sessionId: string;
  roomId: number;
  listingPhotoId: number | null;
  type: RenderCanvasType;
  parentCanvasId: string | null;
  branchLabel: string | null;
  lightingProfile: LightingProfile | null;
  prompt: string | null;
  provider: string | null;
  model: string | null;
  outputCfImageId: string | null;
  outputImageUrl: string | null;
  /** Optional source/starting image, used by the stage explorer before/after view. */
  startingImageUrl?: string | null;
  /** Optional human title produced by the pipeline (ai_title). */
  aiTitle?: string | null;
  status: CanvasStatus;
}

/** Bounding box in **source pixels** ({@link InspirationCanvas} output). */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Bounding box normalized to a 1000x1000 grid so overlays stay
 * resolution-independent across thumbnail sizes ({@link GalleryViewport}).
 */
export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An inspiration reference chip shown in the gallery / sort workspace. */
export interface InspirationReference {
  inspirationImageId: string;
  /** Delivery URL of the full inspiration image. */
  imageUrl: string;
  /** Delivery URL of the extracted snippet (if a region was cropped). */
  extractedImageUrl?: string | null;
  /** Region selected on the inspiration image, in source pixels. */
  referencedRegionBoundingBox?: BoundingBox | null;
  /** Same region normalized to a 1000x1000 grid (for the hover overlay). */
  normalizedBox?: NormalizedBox | null;
  extractionNotes?: string | null;
  /** Position in the model's image_urls array for @image{n} prompting. */
  referenceIndex?: number;
  label?: string | null;
}

/** Design configuration written to render_sessions.designConfig. */
export interface DesignConfig {
  floorMaterial: string;
  wallColor: string;
  cabinetColor: string;
  counterMaterial: string;
  fixtures: string;
  lighting: "day" | "night";
}

/** Payload emitted by {@link InspirationCanvas} on submit. */
export interface ExtractPayload {
  inspirationImageId: string;
  referencedRegionBoundingBox: BoundingBox;
}

/** Realtime pipeline status message ({@link PipelineStatusLoader}). */
export type PipelineStatus =
  | "IDLE"
  | "QUEUED"
  | "RUNNING"
  | "DONE"
  | "FAILED";

export interface PipelineStatusMessage {
  status: PipelineStatus;
  stage: string;
  progress: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a Cloudflare Images id or delivery URL into a usable <img> src.
 * Mirrors the resolveImageUrl idiom used across the existing photo apps.
 */
export function resolveCfImageUrl(
  idOrUrl: string | null | undefined,
  variant = "public",
): string {
  if (!idOrUrl) return "";
  if (idOrUrl.startsWith("http://") || idOrUrl.startsWith("https://")) {
    return idOrUrl;
  }
  if (idOrUrl.includes("/")) {
    // Already an account-hash/image-id pair.
    return `https://imagedelivery.net/${idOrUrl}/${variant}`;
  }
  return `https://imagedelivery.net/${idOrUrl}/${variant}`;
}

/** Map a full canvas type to its coarse timeline bucket. */
export function stageBucketForType(type: RenderCanvasType): StageBucket | null {
  if (type.startsWith("stage_0")) return "stage_0";
  if (type.startsWith("stage_1")) return "stage_1";
  if (type.startsWith("stage_2")) return "stage_2";
  if (type.startsWith("stage_3")) return "stage_3";
  // stage_5 synthesis is a finish-tier node; surface it under stage_3.
  if (type.startsWith("stage_5")) return "stage_3";
  return null;
}

/** Convert a source-pixel box into a 1000x1000 normalized box. */
export function normalizeBox(
  box: BoundingBox,
  sourceWidth: number,
  sourceHeight: number,
): NormalizedBox {
  const safeW = sourceWidth > 0 ? sourceWidth : 1;
  const safeH = sourceHeight > 0 ? sourceHeight : 1;
  return {
    x: (box.x / safeW) * 1000,
    y: (box.y / safeH) * 1000,
    width: (box.width / safeW) * 1000,
    height: (box.height / safeH) * 1000,
  };
}

/** Human-friendly label for a stage bucket. */
export const STAGE_BUCKET_LABEL: Record<StageBucket, string> = {
  stage_0: "Blank Canvas",
  stage_1: "Base",
  stage_2: "Rough-in",
  stage_3: "Finish",
};

/** Map a coarse stage bucket to the action that produces it. */
export const STAGE_BUCKET_ACTION: Record<StageBucket, StageActionType> = {
  stage_0: "INITIAL_BASE",
  stage_1: "INITIAL_BASE",
  stage_2: "STRUCTURAL_MOVE",
  stage_3: "FINISH",
};
