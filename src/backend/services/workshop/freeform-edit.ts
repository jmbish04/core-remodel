/**
 * Freeform conversational image editing (docs/0014) — the power tool alongside
 * the preset recipes. Runs Gemini's Interactions API (multi-turn capable,
 * exposes the model's thinking) on a node image with a free-text instruction:
 * add/remove elements, inpaint a region (via an optional mask), and pull in up
 * to 14 reference images.
 *
 * Same infra as blank-canvas-generator: the Interactions API is NOT Cloudflare-
 * AI-Gateway-compatible, so we call Google DIRECT with GEMINI_API_KEY. Multi-turn
 * iteration is achieved by chaining — each edit runs on the previous result, so
 * the caller just points the next turn at the last output.
 */
import { GoogleGenAI } from "@google/genai";

import { uploadBytesToCfImages } from "../render/cf-images";

/**
 * Selectable image models (nano-banana 2 family). Flash = fast/cheap default,
 * up to 4K. Pro = grounded "Thinking" + professional asset production, up to 4K.
 */
export const EDIT_MODELS = {
  flash: "gemini-3.1-flash-image",
  pro: "gemini-3.1-pro-image",
} as const;
export type EditModelKey = keyof typeof EDIT_MODELS;

/** Default model — flash is the proven, cost-effective all-rounder. */
const DEFAULT_EDIT_MODEL = EDIT_MODELS.flash;
/** Gemini's reference-image cap for a single interaction. */
export const MAX_EDIT_REFERENCES = 14;

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Fetch an image URL and inline it as base64 for the interactions input. */
async function fetchInline(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image for edit: ${res.status}`);
  const mimeType = res.headers.get("content-type") ?? "image/jpeg";
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { data: btoa(binary), mimeType };
}

/** Output resolutions gemini-3.1-flash-image supports (nano-banana 2 table). */
export const EDIT_IMAGE_SIZES = ["512px", "1K", "2K", "4K"] as const;
export type EditImageSize = (typeof EDIT_IMAGE_SIZES)[number];

export interface FreeformEditArgs {
  /** The image being edited (Cloudflare Images delivery URL). */
  imageUrl: string;
  /** Free-text instruction (add/remove/change/inpaint…). */
  prompt: string;
  /** Up to 14 reference images (material/style/subject). */
  referenceCfImageUrls?: string[];
  /** Optional black-and-white inpainting mask (base64 PNG) scoping the edit. */
  maskBase64?: string;
  /** Output resolution (default 2K). "4K" for print-grade. */
  imageSize?: EditImageSize;
  /** Output aspect ratio, e.g. "16:9". Omit to match the input image. */
  aspectRatio?: string;
  /** Model: "flash" (default, fast) or "pro" (grounded thinking, pro-grade). */
  model?: EditModelKey;
}

export interface FreeformEditResult {
  imageId: string;
  deliveryUrl: string;
  /** The model's thinking / narration text for this edit (may be empty). */
  thoughts: string;
}

/** Run one freeform edit turn; returns the new image (uploaded to CF Images) + thoughts. */
export async function freeformEdit(env: Env, args: FreeformEditArgs): Promise<FreeformEditResult> {
  const apiKey = await env.GEMINI_API_KEY.get();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  // Direct client — the Interactions API is not AI-Gateway-compatible.
  const ai = new GoogleGenAI({ apiKey });

  const source = await fetchInline(args.imageUrl);
  const input: Array<{ type: string; text?: string; mime_type?: string; data?: string }> = [
    { type: "text", text: args.prompt },
    { type: "image", mime_type: source.mimeType, data: source.data },
  ];

  for (const url of (args.referenceCfImageUrls ?? []).slice(0, MAX_EDIT_REFERENCES)) {
    const ref = await fetchInline(url);
    input.push({ type: "image", mime_type: ref.mimeType, data: ref.data });
  }
  if (args.maskBase64) {
    input.push({ type: "image", mime_type: "image/png", data: args.maskBase64 });
  }

  // Ask for BOTH the thinking text and the image, and size the image. The array
  // response_format keeps the model's narration while controlling the output
  // (aspect_ratio omitted → matches the input image; image_size default 2K).
  const imageFormat: Record<string, string> = { type: "image", image_size: args.imageSize ?? "2K" };
  if (args.aspectRatio) imageFormat.aspect_ratio = args.aspectRatio;

  // The SDK's interactions types aren't fully exported; the input/step shapes
  // match blank-canvas-generator (the proven caller).
  const interaction = await (ai as any).interactions.create({
    model: args.model ? EDIT_MODELS[args.model] : DEFAULT_EDIT_MODEL,
    input,
    response_format: [{ type: "text" }, imageFormat],
  });

  let imageBytes: ArrayBuffer | null = null;
  let mimeType = "image/png";
  let thoughts = "";
  for (const step of interaction.steps ?? []) {
    if (step.type !== "model_output") continue;
    for (const block of step.content ?? []) {
      if (block.type === "text") thoughts += block.text ?? "";
      else if (block.type === "image" && block.data) {
        imageBytes = base64ToArrayBuffer(block.data);
        mimeType = block.mime_type ?? mimeType;
      }
    }
  }
  if (!imageBytes) throw new Error("The edit returned no image");

  const uploaded = await uploadBytesToCfImages(env, imageBytes, mimeType, "freeform-edit.jpg");
  return { imageId: uploaded.imageId, deliveryUrl: uploaded.deliveryUrl, thoughts: thoughts.trim() };
}
