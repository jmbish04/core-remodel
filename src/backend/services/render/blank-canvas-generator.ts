/**
 * @fileoverview Blank-canvas generation service.
 *
 * Takes a listing photo (furnished room) and uses Gemini to strip all
 * furniture/fixtures/decor, producing a "blank canvas" — an empty room
 * preserving the exact geometry, camera angle, lighting, and finishes.
 *
 * This is the INVERSE of the staged render pipeline: instead of adding
 * finishes to a blank canvas, we're stripping everything to CREATE one.
 */

import { GoogleGenAI } from "@google/genai";

import { getCloudflareAccountId, getCloudflareAiGatewayToken } from "../../utils/secrets";
import { nearestAspectRatio, DEFAULT_IMAGE_SIZE } from "./prompt-kit";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * The furniture-removal prompt. Designed to produce a fully vacant room
 * while preserving all architectural elements and the camera's framing.
 */
const BLANK_CANVAS_PROMPT =
  `You are an expert architectural photo editor.

  Remove ALL furniture, appliances, fixtures, decor, rugs, plants, curtains,
  window treatments, and personal items from this room photo. Leave the space
  completely empty — bare walls, bare floors, bare ceilings.

  Preservation rules (CRITICAL):
  - PRESERVE EXACTLY: flooring (material, color, finish, plank direction),
  every wall and wall color, all windows and their grids, all doors and
  openings, the ceiling, crown molding, baseboards, light switches, outlets,
  the room's dimensions and proportions, and the camera angle.
  - Do NOT invent, move, widen, or close any wall, window, door, or opening.
  - Do NOT crop, zoom, pan, rotate, re-frame, or change the aspect ratio —
  the output framing must match the input one-to-one.
  - Do NOT add any furniture, rugs, decor, plants, or props.
  - Fill any area previously occupied by furniture with the surrounding wall
  color and flooring material, maintaining natural shadows and lighting.
  - The result should look like a vacant, move-in-ready empty room.

  Output: return ONLY the final edited image. Do not return text.
`.trim();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlankCanvasResult {
  imageBytes: ArrayBuffer;
  mimeType: string;
  model: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** Chunked base64 encode (avoids stack overflow on large images). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Generate a blank canvas from a furnished room photo using Gemini.
 *
 * @param imageUrl - Cloudflare Images delivery URL of the source listing photo
 * @param env      - Worker Env (for GEMINI_API_KEY, CLOUDFLARE_ACCOUNT_ID, AI_GATEWAY_ID)
 * @param options  - Optional overrides (model, aspectRatio)
 */
export async function generateBlankCanvas(
  imageUrl: string,
  env: Env,
  options?: {
    model?: string;
    aspectRatio?: string;
    imageSize?: string;
  },
): Promise<BlankCanvasResult> {
  const apiKey = await env.GEMINI_API_KEY.get();
  const accountId = await getCloudflareAccountId(env);
  const AI_GATEWAY_TOKEN = await getCloudflareAiGatewayToken(env);
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured");

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      baseUrl: `https://gateway.ai.cloudflare.com/v1/${accountId}/${env.AI_GATEWAY_ID}/google-ai-studio`,
      headers: {"cf-aig-authorization": `Bearer ${AI_GATEWAY_TOKEN}`}
    },
  });



  const model = options?.model || "gemini-3-pro-image";

  // Fetch the source image and convert to base64.
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Failed to fetch source image: ${imgRes.status}`);
  const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
  const mimeType = imgRes.headers.get("content-type") || "image/jpeg";

  // Detect aspect ratio from image dimensions if not provided.
  // We'll default to 3:2 if we can't detect (nearestAspectRatio handles 0s).
  const aspectRatio = options?.aspectRatio || "3:2";

  const parts: Array<Record<string, unknown>> = [
    { text: BLANK_CANVAS_PROMPT },
    { inlineData: { data: bytesToBase64(imgBytes), mimeType } },
  ];

  const response = await ai.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: ["Image"],
      imageConfig: {
        aspectRatio,
        imageSize: options?.imageSize || DEFAULT_IMAGE_SIZE,
      },
    },
  } as any);

  const candParts = (response as any)?.candidates?.[0]?.content?.parts ?? [];
  for (const part of candParts) {
    const data = part?.inlineData?.data;
    if (data) {
      return {
        imageBytes: base64ToArrayBuffer(data),
        mimeType: part.inlineData.mimeType || "image/png",
        model,
      };
    }
  }

  throw new Error(
    `Gemini returned no image for blank canvas generation (model ${model}). ` +
      `Text: ${(response as any)?.text ?? "(none)"}`,
  );
}
