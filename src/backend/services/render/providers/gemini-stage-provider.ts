import { GoogleGenAI } from "@google/genai";

import { getCloudflareAccountId } from "../../../utils/secrets";
import { DEFAULT_IMAGE_SIZE } from "../prompt-kit";
import type { StageProvider } from "../stage-provider";
import { TransientProviderError, type StageInput, type StageOutput } from "../types";

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

async function urlToInlineData(url: string): Promise<{ data: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image ${url}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mimeType = res.headers.get("content-type") || "image/jpeg";
  return { data: bytesToBase64(bytes), mimeType };
}

/**
 * Create a Gemini client routed through Cloudflare AI Gateway.
 *
 * This is the single shared Gemini client factory for Worker-side code. It
 * preserves the existing google-ai-studio Gateway route while avoiding ad-hoc
 * client construction in agents and service modules.
 */
export async function createGeminiAiGatewayClient(env: Env): Promise<GoogleGenAI> {
  const apiKey = await env.GEMINI_API_KEY.get();
  const accountId = await getCloudflareAccountId(env);
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  if (!accountId) throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured");

  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      baseUrl: `https://gateway.ai.cloudflare.com/v1/${accountId}/${env.AI_GATEWAY_ID}/google-ai-studio`,
    },
  });
}

/**
 * Gemini 3 Pro Image via Cloudflare AI Gateway (google-ai-studio path). Pins
 * aspect_ratio + image_size via imageConfig — the proven control that stops the
 * model re-cropping to portrait / downsizing. Edits the real image (never generates
 * from scratch), so room geometry is preserved.
 */
export class GeminiStageProvider implements StageProvider {
  readonly name = "gemini" as const;

  async run(input: StageInput, env: Env): Promise<StageOutput> {
    const ai = await createGeminiAiGatewayClient(env);

    const model = input.model || "gemini-3-pro-image";

    // prompt + base/working image + scoped reference images (all inline base64).
    const parts: Array<Record<string, unknown>> = [{ text: input.prompt }];
    parts.push({ inlineData: await urlToInlineData(input.inputImageUrl) });
    for (const ref of input.references ?? []) {
      parts.push({ text: `Reference — ${ref.label}:` });
      parts.push({ inlineData: await urlToInlineData(ref.url) });
    }

    let response: any;
    try {
      response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          responseModalities: ["Image"],
          imageConfig: {
            aspectRatio: input.aspectRatio,
            imageSize: input.imageSize || DEFAULT_IMAGE_SIZE,
          },
        },
      } as any);
    } catch (err: any) {
      const status = Number(err?.status ?? err?.code ?? 0);
      if (status === 429 || (status >= 500 && status < 600)) {
        throw new TransientProviderError(status || 503, String(err?.message ?? err));
      }
      throw err;
    }

    const candParts = response?.candidates?.[0]?.content?.parts ?? [];
    for (const part of candParts) {
      const data = part?.inlineData?.data;
      if (data) {
        return {
          imageBytes: base64ToArrayBuffer(data),
          mimeType: part.inlineData.mimeType || "image/png",
          model,
          provider: "gemini",
        };
      }
    }
    throw new Error(`Gemini returned no image (model ${model}). Text: ${response?.text ?? "(none)"}`);
  }
}
