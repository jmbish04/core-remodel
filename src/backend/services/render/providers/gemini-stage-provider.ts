import { GoogleGenAI } from "@google/genai";
import { drizzle } from "drizzle-orm/d1";

import { geminiUsage } from "@backend/db/schema";
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

/** Shape of the `usageMetadata` returned on a Gemini `generateContent` response. */
interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
}

/**
 * Append a row to `gemini_usage_log`. Best-effort and self-contained: a logging
 * failure NEVER propagates to (or breaks) the underlying AI call. This is our
 * independent, first-party token ledger for spend reconciliation.
 */
export async function logGeminiUsage(
  env: Env,
  entry: {
    model: string;
    feature: string;
    status: "ok" | "error";
    usage?: GeminiUsageMetadata | null;
    error?: unknown;
  },
): Promise<void> {
  try {
    const u = entry.usage ?? {};
    await drizzle(env.DB)
      .insert(geminiUsage)
      .values({
        model: entry.model || "unknown",
        feature: entry.feature || "unknown",
        status: entry.status,
        promptTokens: u.promptTokenCount ?? null,
        candidatesTokens: u.candidatesTokenCount ?? null,
        thoughtsTokens: u.thoughtsTokenCount ?? null,
        cachedTokens: u.cachedContentTokenCount ?? null,
        totalTokens: u.totalTokenCount ?? null,
        errorMessage: entry.error ? String(entry.error).slice(0, 1000) : null,
        requestMeta: { model: entry.model, feature: entry.feature },
      });
  } catch (logErr) {
    console.error("[gemini-usage] failed to log usage:", logErr);
  }
}

/**
 * Wrap a `GoogleGenAI` client so every `models.generateContent` call records a
 * `gemini_usage_log` row (tokens on success, error on failure) before the
 * result/exception is returned to the caller. Centralizing here means all ~12
 * call sites get usage accounting with zero changes.
 *
 * Note: only the (non-streaming) `generateContent` path is instrumented today;
 * that is where email classification, deep research, and image generation all
 * consume tokens. `generateContentStream` is not yet wrapped.
 */
function wrapWithUsageLogging(
  ai: GoogleGenAI,
  env: Env,
  feature: string,
): GoogleGenAI {
  const models = ai.models;
  const original = models.generateContent.bind(models);

  (models as any).generateContent = async (params: any) => {
    const model = params?.model ?? "unknown";
    try {
      const response = await original(params);
      await logGeminiUsage(env, {
        model,
        feature,
        status: "ok",
        usage: (response as any)?.usageMetadata ?? null,
      });
      return response;
    } catch (err) {
      await logGeminiUsage(env, { model, feature, status: "error", error: err });
      throw err;
    }
  };

  return ai;
}

/**
 * Create a Gemini client that talks to the Google Gemini API DIRECTLY.
 *
 * NOTE ON THE NAME: kept as `createGeminiAiGatewayClient` for call-site
 * compatibility, but this NO LONGER routes through Cloudflare AI Gateway — the
 * current Gemini interactions API is not gateway-compatible, and the gateway
 * was returning 401 (AiGatewayError 2009) for every call. We now hit Google
 * directly with the API key. Use the `createGeminiClient` alias in new code.
 *
 * Every returned client is wrapped so each `generateContent` call is recorded
 * in `gemini_usage_log` under the given `feature` label — our own token ledger,
 * independent of the provider's billing dashboard.
 *
 * @param env Worker env (GEMINI_API_KEY secret + DB binding for usage logging).
 * @param feature Calling-surface label for cost attribution (e.g.
 *   "email_classify"). Defaults to "unknown".
 */
export async function createGeminiAiGatewayClient(
  env: Env,
  feature = "unknown",
): Promise<GoogleGenAI> {
  const apiKey = await env.GEMINI_API_KEY.get();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const ai = new GoogleGenAI({ apiKey });
  return wrapWithUsageLogging(ai, env, feature);
}

/** Honest-named alias for {@link createGeminiAiGatewayClient} — prefer in new code. */
export const createGeminiClient = createGeminiAiGatewayClient;

/**
 * Gemini 3 Pro Image via Cloudflare AI Gateway (google-ai-studio path). Pins
 * aspect_ratio + image_size via imageConfig — the proven control that stops the
 * model re-cropping to portrait / downsizing. Edits the real image (never generates
 * from scratch), so room geometry is preserved.
 */
export class GeminiStageProvider implements StageProvider {
  readonly name = "gemini" as const;

  async run(input: StageInput, env: Env): Promise<StageOutput> {
    const ai = await createGeminiAiGatewayClient(env, "image_stage");

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
