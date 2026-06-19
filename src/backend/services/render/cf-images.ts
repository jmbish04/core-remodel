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
