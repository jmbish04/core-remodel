/**
 * @fileoverview Pascal scene screenshot capture (0043 Phase 3).
 *
 * Renders a Pascal scene URL through Cloudflare Browser Rendering and uploads the
 * PNG to Cloudflare Images — no Cloudflare credential ever leaves the worker.
 *
 * ⚠️ Pascal is a client-side WebGPU/Three scene; a headless browser may not paint
 * the canvas. If capture returns blank/empty, use the editor-canvas fallback
 * (`POST /api/pascal/v1/scenes/:id/snapshot`, editor posts the PNG bytes) which
 * routes to `storeSnapshotBytes` below.
 */
import { uploadBytesToCfImages } from "../render/cf-images";
import { assertCanSpend, recordBrowserRun } from "../usage/metered-ai";

const GOTO_TIMEOUT_MS = 60_000;
const SNAPSHOT_TIMEOUT_MS = 120_000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export interface CaptureResult {
  imageId: string;
  deliveryUrl: string;
}

/** Capture a screenshot of `sceneUrl` via Browser Rendering → CF Images. */
export async function captureSceneScreenshot(
  env: Env,
  sceneUrl: string,
  opts: { width?: number; height?: number; fullPage?: boolean } = {},
): Promise<CaptureResult> {
  await assertCanSpend(env, "BROWSER_RENDERING");

  const accountId = await env.CLOUDFLARE_ACCOUNT_ID.get();
  const token = await env.CF_BROWSER_RENDER_TOKEN.get();
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering`;

  const res = await fetch(`${base}/snapshot`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      url: sceneUrl,
      formats: ["screenshot"],
      gotoOptions: { waitUntil: "networkidle2", timeout: GOTO_TIMEOUT_MS },
      screenshotOptions: { fullPage: opts.fullPage ?? false },
      viewport: { width: opts.width ?? 1440, height: opts.height ?? 900 },
    }),
    signal: AbortSignal.timeout(SNAPSHOT_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text();
    await recordBrowserRun(env, {
      feature: "pascal_scene_screenshot",
      url: sceneUrl,
      status: "error",
      errorMessage: `${res.status} ${body}`.slice(0, 500),
    });
    throw new Error(`Browser Rendering snapshot failed: ${res.status} ${body}`);
  }
  await recordBrowserRun(env, { feature: "pascal_scene_screenshot", url: sceneUrl });

  const payload = (await res.json()) as { result?: { screenshot?: string } };
  const b64 = payload.result?.screenshot;
  if (!b64) throw new Error("Browser Rendering returned no screenshot (blank scene?)");
  const bytes = b64ToBytes(b64);
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Screenshot exceeds 10MB");

  return uploadBytesToCfImages(
    env,
    bytes.buffer as ArrayBuffer,
    "image/png",
    "pascal-scene.png",
  );
}

/** Fallback: store editor-captured PNG bytes (canvas capture) into CF Images. */
export async function storeSnapshotBytes(
  env: Env,
  bytes: ArrayBuffer,
): Promise<CaptureResult> {
  if (bytes.byteLength === 0) throw new Error("Empty image");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Screenshot exceeds 10MB");
  return uploadBytesToCfImages(env, bytes, "image/png", "pascal-scene.png");
}
