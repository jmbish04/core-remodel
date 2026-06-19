/**
 * Mood board generation service.
 *
 * Supports three modes:
 *  - prompt only        → generate from the natural-language prompt
 *  - image(s) only      → compose a mood board from the provided images
 *  - prompt + image(s)  → the prompt is context/instructions for the images
 *
 * Generates via Gemini 3 Pro Image (AI Gateway), uploads to Cloudflare Images,
 * summarizes with Workers AI vision (llama-3.2-11b) into ai_title + ai_description,
 * and stores the request + result in `mood_board_generations`.
 */
import { GoogleGenAI } from "@google/genai";
import { moodBoardGenerations } from "@backend/db";
import { drizzle } from "drizzle-orm/d1";

import { getCloudflareAccountId, resolveCloudflareImagesCredentials } from "../../utils/secrets";
import { ImageProcessorService } from "../image-processor";
import { uploadBytesToCfImages } from "./cf-images";

export const MOOD_BOARD_PROMPT =
  "CREATE A PHOTOGRAPH OF AN INTERIOR DESIGN MOOD BOARD THAT INCORPORATES ELEMENTS FROM ALL THE UPLOADED IMAGES. THE MOOD BOARD SHOULD BE ORGANIZED, THOUGHT OUT, AND CRAFTED LIKE A PROFESSIONAL INTERIOR DESIGN MOOD BOARD FLATLAY FOR DESIGN PURPOSES. MINIMALLY OVERLAP ELEMENTS WHEN APPLICABLE AND USE DESIGN TECHNIQUES LIKE COLLAGING AND TRANSPARENCY. WHITE BACKGROUND. DO NOT INCLUDE ANY TEXT.";

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

async function urlToInlineData(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch source image ${url}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { data: btoa(bin), mimeType: res.headers.get("content-type") || "image/jpeg" };
}

export interface GenerateMoodBoardArgs {
  env: Env;
  prompt?: string | null;
  imageUrls?: string[];
  roomId?: number | null;
  floorId?: number | null;
  source?: string;
}

export interface MoodBoardRecord {
  id: string;
  outputImageUrl: string;
  outputCfImageId: string;
  aiTitle: string;
  aiDescription: string;
}

export async function generateMoodBoard(args: GenerateMoodBoardArgs): Promise<MoodBoardRecord> {
  const { env } = args;
  const userCtx = args.prompt?.trim() || "";
  const fullPrompt = userCtx
    ? `${MOOD_BOARD_PROMPT}\n\nDesign context / instructions for these elements: ${userCtx}`
    : MOOD_BOARD_PROMPT;

  const apiKey = await env.GEMINI_API_KEY.get();
  const accountId = await getCloudflareAccountId(env);
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured");

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      baseUrl: `https://gateway.ai.cloudflare.com/v1/${accountId}/${env.AI_GATEWAY_ID}/google-ai-studio`,
    },
  });

  const parts: Array<Record<string, unknown>> = [{ text: fullPrompt }];
  for (const url of args.imageUrls ?? []) {
    parts.push({ inlineData: await urlToInlineData(url) });
  }

  const response: any = await ai.models.generateContent({
    model: "gemini-3-pro-image",
    contents: [{ role: "user", parts }],
    config: {
      responseModalities: ["Image"],
      imageConfig: { aspectRatio: "1:1", imageSize: "2K" },
    },
  } as any);

  let outBytes: ArrayBuffer | null = null;
  let mime = "image/png";
  for (const p of response?.candidates?.[0]?.content?.parts ?? []) {
    if (p?.inlineData?.data) {
      outBytes = base64ToArrayBuffer(p.inlineData.data);
      mime = p.inlineData.mimeType || mime;
      break;
    }
  }
  if (!outBytes) {
    throw new Error(`Mood board generation returned no image. Text: ${response?.text ?? "(none)"}`);
  }

  const uploaded = await uploadBytesToCfImages(env, outBytes, mime, "moodboard.jpg");

  // Summarize with Workers AI vision (non-fatal).
  let aiTitle = "Mood Board";
  let aiDescription = "";
  try {
    const creds = await resolveCloudflareImagesCredentials(env);
    if (creds.accountId && creds.apiTokens.length > 0) {
      const processor = new ImageProcessorService(env, creds.accountId, creds.apiTokens[0], {
        fallbackApiTokens: creds.apiTokens.slice(1),
      });
      aiDescription = await processor.describeImage(uploaded.deliveryUrl);
      try {
        const analysis = await processor.analyzeVisionSummary(aiDescription);
        if (analysis?.suggestedDisplayName) aiTitle = analysis.suggestedDisplayName;
      } catch {
        /* title falls back to default */
      }
    }
  } catch {
    /* summary is best-effort */
  }

  const db = drizzle(env.DB);
  const id = crypto.randomUUID();
  await db
    .insert(moodBoardGenerations)
    .values({
      id,
      prompt: userCtx || null,
      sourceImages: args.imageUrls?.length
        ? JSON.stringify(args.imageUrls.map((url) => ({ url })))
        : null,
      outputCfImageId: uploaded.imageId,
      outputImageUrl: uploaded.deliveryUrl,
      aiTitle,
      aiDescription,
      roomId: args.roomId ?? null,
      floorId: args.floorId ?? null,
      model: "gemini-3-pro-image",
      source: args.source ?? "api",
      status: "done",
    })
    .run();

  return {
    id,
    outputImageUrl: uploaded.deliveryUrl,
    outputCfImageId: uploaded.imageId,
    aiTitle,
    aiDescription,
  };
}
