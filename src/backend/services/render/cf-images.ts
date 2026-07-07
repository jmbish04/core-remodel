/**
 * Cloudflare Images upload helpers for the render pipeline. Reuses the existing
 * ImageProcessorService (correct v4 accounts/{id}/images/v1 endpoint + token).
 */
import { resolveCloudflareImagesCredentials } from "../../utils/secrets";
import { ImageProcessorService } from "../image-processor";

export interface CfImageResult {
  imageId: string;
  deliveryUrl: string;
}

async function makeProcessor(env: Env): Promise<ImageProcessorService> {
  const creds = await resolveCloudflareImagesCredentials(env);
  if (!creds.accountId || creds.apiTokens.length === 0) {
    throw new Error("Cloudflare Images credentials are not configured");
  }
  return new ImageProcessorService(env, creds.accountId, creds.apiTokens[0], {
    fallbackApiTokens: creds.apiTokens.slice(1),
  });
}

export async function uploadBlobToCfImages(
  env: Env,
  blob: Blob,
  filename = "render.jpg",
): Promise<CfImageResult> {
  const processor = await makeProcessor(env);
  const id = crypto.randomUUID();
  const resp = await processor.uploadToCloudflareImages(blob, id, filename);
  const deliveryUrl = processor.getDeliveryUrl(resp, id);
  return { imageId: resp.result?.id ?? id, deliveryUrl };
}

export async function uploadBytesToCfImages(
  env: Env,
  bytes: ArrayBuffer,
  mimeType = "image/jpeg",
  filename = "render.jpg",
): Promise<CfImageResult> {
  return uploadBlobToCfImages(env, new Blob([bytes], { type: mimeType }), filename);
}

export async function uploadFromUrlToCfImages(
  env: Env,
  url: string,
  filename = "render.jpg",
): Promise<CfImageResult> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch result image ${url}: ${res.status}`);
  return uploadBlobToCfImages(env, await res.blob(), filename);
}

/** Normalized (0..1) crop box, in the coordinate space of the source image. */
export interface NormalizedBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Fetch a Cloudflare Images delivery URL's bytes and probe its true pixel
 * dimensions via the native `env.IMAGES.info()` transform binding — NEVER
 * `sharp`/libvips. Used to pin `image_config {aspect_ratio}` from the REAL
 * source dims (FABLE_PROMPT hard constraint) rather than an on-canvas node's
 * placeholder width/height, which Gemini 3.x will otherwise silently re-crop
 * against.
 *
 * Throws if the fetch fails or the source isn't a raster image (e.g. SVG,
 * which `info()` reports without width/height) — callers should catch and
 * fall back rather than block the run.
 */
export async function probeCfImageDimensions(
  env: Env,
  sourceUrl: string,
): Promise<{ width: number; height: number }> {
  const sourceRes = await fetch(sourceUrl);
  if (!sourceRes.ok) {
    throw new Error(`Failed to fetch source image ${sourceUrl}: ${sourceRes.status}`);
  }
  const sourceBytes = await sourceRes.arrayBuffer();
  const info = await env.IMAGES.info(new Blob([sourceBytes]).stream());
  const width = "width" in info ? info.width : 0;
  const height = "height" in info ? info.height : 0;
  if (!width || !height) {
    throw new Error(`Could not determine source image dimensions for ${sourceUrl}`);
  }
  return { width, height };
}

/**
 * Crop a Cloudflare Images delivery URL to a normalized bbox using the native
 * `env.IMAGES` transform binding (`.input().transform({ trim }).output()`) —
 * NEVER `sharp`/libvips. Returns the cropped bytes (not yet re-uploaded); callers
 * upload the result to Cloudflare Images to mint a stable, permanent asset (see
 * `uploadBlobToCfImages`).
 *
 * `env.IMAGES.info()` reads the source pixel dimensions so the normalized bbox
 * can be converted into the pixel `trim` offsets the transform API expects.
 */
export async function cropCfImageToBbox(
  env: Env,
  sourceUrl: string,
  bbox: NormalizedBbox,
): Promise<{ blob: Blob; width: number; height: number }> {
  const sourceRes = await fetch(sourceUrl);
  if (!sourceRes.ok) {
    throw new Error(`Failed to fetch source image ${sourceUrl}: ${sourceRes.status}`);
  }
  const sourceBytes = await sourceRes.arrayBuffer();

  const info = await env.IMAGES.info(new Blob([sourceBytes]).stream());
  const sourceWidth = "width" in info ? info.width : 0;
  const sourceHeight = "height" in info ? info.height : 0;
  if (!sourceWidth || !sourceHeight) {
    throw new Error(`Could not determine source image dimensions for ${sourceUrl}`);
  }

  const left = Math.max(0, Math.round(bbox.x * sourceWidth));
  const top = Math.max(0, Math.round(bbox.y * sourceHeight));
  const cropWidth = Math.max(1, Math.round(bbox.width * sourceWidth));
  const cropHeight = Math.max(1, Math.round(bbox.height * sourceHeight));
  const right = Math.max(0, sourceWidth - left - cropWidth);
  const bottom = Math.max(0, sourceHeight - top - cropHeight);

  const result = await env.IMAGES.input(new Blob([sourceBytes]).stream())
    .transform({ trim: { top, bottom, left, right } })
    .output({ format: "image/jpeg", quality: 90 });

  const blob = await new Response(result.image()).blob();
  return { blob, width: cropWidth, height: cropHeight };
}

/** Crop a delivery URL to a normalized bbox and upload the result as a new CF Images asset. */
export async function cropAndUploadCfImage(
  env: Env,
  sourceUrl: string,
  bbox: NormalizedBbox,
  filename = "clipping.jpg",
): Promise<CfImageResult & { width: number; height: number }> {
  const { blob, width, height } = await cropCfImageToBbox(env, sourceUrl, bbox);
  const uploaded = await uploadBlobToCfImages(env, blob, filename);
  return { ...uploaded, width, height };
}
