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

/** gemini-3.1 flash image — reads/writes images + returns thinking text. */
const EDIT_MODEL = "gemini-3.1-flash-image";
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

export interface FreeformEditArgs {
  /** The image being edited (Cloudflare Images delivery URL). */
  imageUrl: string;
  /** Free-text instruction (add/remove/change/inpaint…). */
  prompt: string;
  /** Up to 14 reference images (material/style/subject). */
  referenceCfImageUrls?: string[];
  /** Optional black-and-white inpainting mask (base64 PNG) scoping the edit. */
  maskBase64?: string;
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

  // The SDK's interactions types aren't fully exported; the input/step shapes
  // match blank-canvas-generator (the proven caller).
  const interaction = await (ai as any).interactions.create({ model: EDIT_MODEL, input });

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
