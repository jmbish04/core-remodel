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

import { getCloudflareAccountId } from "../../utils/secrets";
import { nearestAspectRatio, DEFAULT_IMAGE_SIZE } from "./prompt-kit";

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * Build the furniture-removal prompt dynamically.
 * Designed to produce a fully vacant room while preserving all architectural
 * elements and the camera's framing, with optional plumbing guidelines.
 */
export function buildBlankCanvasPrompt(options?: {
  leaveOutline?: boolean;
  hasWindows?: boolean;
  hasSkylights?: boolean;
}): string {
  const leaveOutline = options?.leaveOutline ?? false;
  const hasWindows = options?.hasWindows ?? true;
  const hasSkylights = options?.hasSkylights ?? false;

  const windowInstruction = hasWindows
    ? "all windows and their grids, all doors and openings, "
    : "all doors and openings, ";

  const windowPreserve = hasWindows
    ? "all windows and their grids, all doors and openings, "
    : "all doors and openings, ";

  const windowWallPreserve = hasWindows
    ? "wall, window, door, or opening."
    : "wall, door, or opening.";

  const skylightPreserve = hasSkylights
    ? " (including skylights)"
    : "";

  return `Using the provided image of this room, please remove all furniture, appliances, fixtures, decor, rugs, plants, curtains, window treatments, personal items, cabinets, countertops, vanities, built-ins, and all ceiling lights, lamps, chandeliers, and lighting fixtures from the scene. Ensure the change is integrated as a vacant, move-in-ready empty room: leave the space completely empty (bare walls, bare floors, and empty ceilings), and preserve exactly the flooring (material, color, finish, plank direction), every wall and wall color, ${windowInstruction}the ceiling structure itself (material, texture, shape, color), baseboards, light switches, outlets, the room's dimensions and proportions, and the camera angle. Fill any area previously occupied by furniture with the surrounding wall color and flooring material, maintaining natural shadows and lighting, with no cropping, zooming, panning, rotating, or aspect ratio changes.

Plumbing Fixture Rules:
${
  leaveOutline
    ? "- Leave a faint, thin, subtle outline/boundary line on the floor or wall where important plumbing fixtures (toilet, vanity/sink, shower, bathtub) originally stood, so that their exact positions and plumbing connections are clearly indicated for future renovation layout references."
    : "- Completely remove all plumbing fixtures (toilet, vanity, sink, shower, bathtub) with no faint outlines, marks, or traces remaining."
}

Preservation rules (CRITICAL):
- PRESERVE THE CEILING STRUCTURE EXACTLY: Keep the ceiling material, texture, shape, and color${skylightPreserve} exactly as they are. Only delete the ceiling lights and light fixtures themselves, seamlessly patching the spots where the lights were to match the surrounding ceiling surface.
- PRESERVE EXACTLY: flooring (material, color, finish, plank direction), every wall and wall color, ${windowPreserve}baseboards, light switches, outlets, the room's dimensions and proportions, and the camera angle.
- Do NOT invent, move, widen, or close any ${windowWallPreserve}
- Do NOT crop, zoom, pan, rotate, re-frame, or change the aspect ratio — the output framing must match the input one-to-one.
- Do NOT add any furniture, rugs, decor, plants, or props.
- Fill any area previously occupied by furniture or removed items with the surrounding wall color and flooring material, maintaining natural shadows and lighting.
- The result should look like a vacant, move-in-ready empty room.

Reflection & Cleanliness rules:
- REMOVE REFLECTIONS: IGNORE REFLECTIONS, DO NOT BE CONFUSED THAT THE ROOM IS LARGER ETC - Verify that all reflections of the removed elements (including light fixtures, furniture, cabinets, etc.) are completely removed from any remaining mirror doors, glass panels, or window reflections.
- Cleanly patch any mirror or window reflections to show only the empty room, empty ceiling, and appropriate empty room reflections.

Output: return ONLY the final edited image. Do not return text.`.trim();
}

const BLANK_CANVAS_PROMPT = buildBlankCanvasPrompt({ leaveOutline: false, hasWindows: true, hasSkylights: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlankCanvasResult {
  imageBytes: ArrayBuffer;
  mimeType: string;
  model: string;
  thoughts?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Source images larger than this are rejected instead of buffered blindly —
 * guards against unbounded `arrayBuffer()` reads (and the base64 blow-up
 * that follows) on unexpectedly huge listing photos.
 */
const MAX_SOURCE_IMAGE_BYTES = 15 * 1024 * 1024; // 15MB

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
 * @param options  - Optional overrides (model, aspectRatio, leaveOutline, maskBase64, promptOverride)
 */
export async function generateBlankCanvas(
  imageUrl: string,
  env: Env,
  options?: {
    model?: string;
    aspectRatio?: string;
    imageSize?: string;
    leaveOutline?: boolean;
    maskBase64?: string;
    promptOverride?: string;
  },
): Promise<BlankCanvasResult> {
  console.log(`[generateBlankCanvas] START - imageUrl: ${imageUrl}`);

  let apiKey: string;
  let accountId: string | null;

  try {
    apiKey = await env.GEMINI_API_KEY.get();
    console.log(
      `[generateBlankCanvas] Resolved GEMINI_API_KEY (exists: ${!!apiKey}, len: ${apiKey?.length || 0})`,
    );
  } catch (keyErr: any) {
    console.error(
      `[generateBlankCanvas] Failed to retrieve GEMINI_API_KEY:`,
      keyErr,
    );
    throw new Error(
      `Failed to retrieve GEMINI_API_KEY: ${keyErr.message || keyErr}`,
    );
  }

  try {
    accountId = await getCloudflareAccountId(env);
    console.log(
      `[generateBlankCanvas] Resolved CLOUDFLARE_ACCOUNT_ID: ${accountId}`,
    );
  } catch (accErr: any) {
    console.error(
      `[generateBlankCanvas] Failed to retrieve CLOUDFLARE_ACCOUNT_ID:`,
      accErr,
    );
    throw new Error(
      `Failed to retrieve CLOUDFLARE_ACCOUNT_ID: ${accErr.message || accErr}`,
    );
  }

  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured");

  const baseUrl = `https://gateway.ai.cloudflare.com/v1/${accountId}/${env.AI_GATEWAY_ID}/google-ai-studio`;
  console.log(
    `[generateBlankCanvas] Initializing GoogleGenAI client with baseUrl: ${baseUrl}`,
  );

  // Gemini Interactions API is not supported by Cloudflare AI Gateway
  const ai = new GoogleGenAI({
    apiKey,
    // httpOptions: {
    //   baseUrl,
    //   headers: { "cf-aig-authorization": `Bearer ${AI_GATEWAY_TOKEN}` },
    // },
  });

  const model = options?.model || "gemini-3.1-flash-image";
  console.log(`[generateBlankCanvas] Model set to: ${model}`);

  // Fetch the source image and convert to base64.
  console.log(`[generateBlankCanvas] Fetching source image: ${imageUrl}`);
  let imgRes: Response;
  try {
    imgRes = await fetch(imageUrl);
  } catch (fetchErr: any) {
    console.error(
      `[generateBlankCanvas] Network error fetching source image:`,
      fetchErr,
    );
    throw new Error(
      `Network error fetching source image: ${fetchErr.message || fetchErr}`,
    );
  }

  console.log(
    `[generateBlankCanvas] Fetch source image response status: ${imgRes.status} (${imgRes.statusText})`,
  );
  if (!imgRes.ok) {
    throw new Error(
      `Failed to fetch source image: HTTP ${imgRes.status} ${imgRes.statusText}`,
    );
  }

  // Reject oversized sources before buffering — Content-Length is a fast,
  // cheap check that avoids reading the whole body into memory when the
  // server tells us up front the image is too large.
  const declaredLength = Number(imgRes.headers.get("content-length") || "0");
  if (declaredLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new Error(
      `Source image is too large (${(declaredLength / (1024 * 1024)).toFixed(1)}MB, max ${MAX_SOURCE_IMAGE_BYTES / (1024 * 1024)}MB): ${imageUrl}`,
    );
  }

  let imgBytes: Uint8Array;
  let mimeType: string;
  try {
    const buffer = await imgRes.arrayBuffer();
    if (buffer.byteLength > MAX_SOURCE_IMAGE_BYTES) {
      throw new Error(
        `Source image is too large (${(buffer.byteLength / (1024 * 1024)).toFixed(1)}MB, max ${MAX_SOURCE_IMAGE_BYTES / (1024 * 1024)}MB): ${imageUrl}`,
      );
    }
    imgBytes = new Uint8Array(buffer);
    mimeType = imgRes.headers.get("content-type") || "image/jpeg";
    console.log(
      `[generateBlankCanvas] Read image buffer. MimeType: ${mimeType}, Size: ${imgBytes.length} bytes`,
    );
  } catch (bufErr: any) {
    console.error(
      `[generateBlankCanvas] Failed to process source image bytes:`,
      bufErr,
    );
    throw new Error(
      `Failed to process source image bytes: ${bufErr.message || bufErr}`,
    );
  }

  // Detect aspect ratio from image dimensions if not provided.
  const aspectRatio = options?.aspectRatio || "3:2";

  let prompt = options?.promptOverride;
  if (!prompt) {
    prompt = buildBlankCanvasPrompt({ leaveOutline: options?.leaveOutline });
    if (options?.maskBase64) {
      // Inpainting / Semantic masking template matching user requested layout exactly
      prompt = `Using the provided image, change only the room contents (removing all furniture, appliances, fixtures, decor, rugs, plants, curtains, window treatments, and personal items) and the specific elements highlighted in the black-and-white annotation mask (which highlights cabinetry, ceiling lights, or items to be removed) to empty/vacant space. Keep everything else in the image exactly the same, preserving the original style, lighting, and composition.

Detail instructions:
${prompt}`;
    }
  }

  console.log(
    `[generateBlankCanvas] Prompt length: ${prompt?.length || 0}. Prompt text snippet: ${prompt ? (prompt.length > 200 ? prompt.substring(0, 200) + "..." : prompt) : "undefined"}`,
  );

  // Convert inputs to interactions format
  const input = [
    { type: "text", text: prompt },
    {
      type: "image",
      mime_type: mimeType,
      data: bytesToBase64(imgBytes),
    },
  ];

  if (options?.maskBase64) {
    console.log(
      `[generateBlankCanvas] Appending mask image to input. Mask size: ${options.maskBase64.length} chars`,
    );
    input.push({
      type: "image",
      mime_type: "image/png",
      data: options.maskBase64,
    });
  }

  console.log(`[generateBlankCanvas] Calling ai.interactions.create...`);
  let interaction;
  try {
    interaction = await ai.interactions.create({
      model,
      input: input as any,
    });
    console.log(
      `[generateBlankCanvas] interactions.create returned successfully.`,
    );
  } catch (aiErr: any) {
    console.error(
      `[generateBlankCanvas] ERROR during ai.interactions.create:`,
      aiErr,
    );
    const detailedMsg =
      aiErr instanceof Error ? aiErr.stack || aiErr.message : String(aiErr);
    throw new Error(`GoogleGenAI API call failed: ${detailedMsg}`);
  }

  let imageBytes: ArrayBuffer | null = null;
  let responseMimeType = "image/png";
  let thoughts = "";

  const steps = interaction.steps || [];
  console.log(
    `[generateBlankCanvas] Interaction steps returned count: ${steps.length}`,
  );

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log(`[generateBlankCanvas] Step ${i}: type=${step.type}`);
    if (step.type === "model_output") {
      const contentBlocks = step.content || [];
      console.log(
        `[generateBlankCanvas] Step ${i} content blocks count: ${contentBlocks.length}`,
      );
      for (let j = 0; j < contentBlocks.length; j++) {
        const contentBlock = contentBlocks[j];
        console.log(
          `[generateBlankCanvas] ContentBlock ${j}: type=${contentBlock.type}`,
        );
        if (contentBlock.type === "text") {
          thoughts += contentBlock.text || "";
        } else if (contentBlock.type === "image" && contentBlock.data) {
          console.log(
            `[generateBlankCanvas] Found output image data in ContentBlock ${j}. Size: ${contentBlock.data.length} chars`,
          );
          imageBytes = base64ToArrayBuffer(contentBlock.data);
          responseMimeType = contentBlock.mime_type || "image/png";
        }
      }
    }
  }

  if (imageBytes) {
    console.log(
      `[generateBlankCanvas] SUCCESS - Generated blank canvas image size: ${imageBytes.byteLength} bytes`,
    );
    return {
      imageBytes,
      mimeType: responseMimeType,
      model,
      thoughts: thoughts.trim() || undefined,
    };
  }

  console.warn(
    `[generateBlankCanvas] FAILED - No image returned by Gemini. Thoughts length: ${thoughts.trim().length}`,
  );
  const err = new Error(
    `Gemini returned no image for blank canvas generation (model ${model}).`,
  );
  if (thoughts.trim()) {
    (err as any).thoughts = thoughts.trim();
  }
  throw err;
}
