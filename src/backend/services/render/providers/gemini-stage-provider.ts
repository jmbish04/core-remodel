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
 * Per-model token pricing, USD per 1,000,000 tokens.
 *
 * WHY THIS EXISTS: `gemini_usage_log.estimated_cost_usd` was never written —
 * the logger recorded tokens but no cost — so the integration-usage page could
 * only report "not tracked" across ~1,400 calls. Tokens alone do not answer
 * "what are we spending".
 *
 * VERIFY BEFORE TRUSTING FOR BILLING. These are list rates noted 2026-07-22 from
 * Google's published Gemini API pricing; they change, and they do not account
 * for context-length tiers, batch discounts or free-tier allowances. This is a
 * first-party ESTIMATE for spotting runaway usage early — the provider's invoice
 * remains authoritative.
 *
 * A model absent from this table records NULL cost rather than 0. Zero would
 * read as "this was free", which is a worse lie than "unknown".
 */
const MODEL_PRICING_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-3-pro-preview": { input: 1.25, output: 10.0 },
  "gemini-3-flash-preview": { input: 0.3, output: 2.5 },
};

/**
 * Estimate the USD cost of one call. Returns null when the model is unpriced or
 * no token counts were reported, so the caller stores NULL and the UI can say
 * "not tracked" instead of implying the call was free.
 */
function estimateCostUsd(
  model: string,
  usage: GeminiUsageMetadata,
): number | null {
  // Match on a prefix so dated variants ("gemini-2.5-flash-002") still price.
  const key = Object.keys(MODEL_PRICING_PER_MTOK).find((k) => model.startsWith(k));
  if (!key) return null;

  const rate = MODEL_PRICING_PER_MTOK[key];
  const inputTokens = usage.promptTokenCount ?? 0;
  // Thinking tokens are billed as output on the 2.5 line.
  const outputTokens =
    (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  if (inputTokens === 0 && outputTokens === 0) return null;

  const cost =
    (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output;
  // Six decimals: a single cheap call rounds to zero at four.
  return Number(cost.toFixed(6));
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
        // Null (not 0) when unpriced — see estimateCostUsd.
        estimatedCostUsd: entry.status === "ok" ? estimateCostUsd(entry.model, u) : null,
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
