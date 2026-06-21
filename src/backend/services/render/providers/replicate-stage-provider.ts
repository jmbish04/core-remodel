import { getCloudflareAccountId, getReplicateApiToken } from "../../../utils/secrets";
import type { StageProvider } from "../stage-provider";
import { TransientProviderError } from "../types";
import type { StageInput, StageOutput } from "../types";

/** Poll cadence + ceiling for the async Replicate fallback path (Prefer: wait timeout). */
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

/**
 * Replicate image-model provider, routed through the Cloudflare AI Gateway native
 * `/replicate` provider path (never the raw `https://api.replicate.com` host).
 *
 * Replicate runs predictions ASYNCHRONOUSLY. We send `Prefer: wait` so the create call
 * blocks up to ~60s and usually returns a finished prediction; if it times out (still
 * `processing`/`starting`) we poll `urls.get` until terminal.
 *
 * NOTE: The exact Replicate model slugs (e.g. `black-forest-labs/flux-depth-pro`,
 * `black-forest-labs/flux-kontext-max`) and their per-model input field names are TO BE
 * VERIFIED against the live Replicate catalog. The input mapping below uses `image` for
 * the source image and best-effort `aspect_ratio`; some models instead expect
 * `control_image` / `input_image`, or do not support aspect/size at all.
 */
export class ReplicateStageProvider implements StageProvider {
  readonly name = "replicate" as const;

  async run(input: StageInput, env: Env): Promise<StageOutput> {
    const model = input.model;
    if (!model) {
      throw new Error("ReplicateStageProvider requires input.model (a Replicate model slug).");
    }

    const [replicateToken, accountId] = await Promise.all([
      getReplicateApiToken(env),
      getCloudflareAccountId(env),
    ]);

    if (!accountId) {
      throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured for the AI Gateway.");
    }

    // Gateway base is unauthenticated here (matching the working Gemini path): we do
    // NOT add a `cf-aig-authorization` header.
    const gatewayBase = `https://gateway.ai.cloudflare.com/v1/${accountId}/${env.AI_GATEWAY_ID}`;
    const createUrl = `${gatewayBase}/replicate/v1/models/${model}/predictions`;

    // Map our normalized StageInput → Replicate model inputs. Exact field names are
    // model-specific and TO BE VERIFIED; `image` + `aspect_ratio` are best-effort defaults.
    const modelInput: Record<string, unknown> = {
      prompt: input.prompt,
      // Source image. Some models expect `control_image` or `input_image` instead — verify.
      image: input.inputImageUrl,
    };
    if (input.aspectRatio) {
      // Best-effort: ignored by models that don't support it.
      modelInput.aspect_ratio = input.aspectRatio;
    }

    const authHeader = `Bearer ${replicateToken}`;
    const res = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        // Block up to ~60s server-side so we usually avoid polling entirely.
        Prefer: "wait",
      },
      body: JSON.stringify({ input: modelInput }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (res.status === 429 || res.status >= 500) {
        throw new TransientProviderError(res.status, text);
      }
      throw new Error(`Replicate request failed (${res.status}): ${text}`);
    }

    let prediction = (await res.json()) as ReplicatePrediction;

    // If `Prefer: wait` timed out the prediction may still be running — poll until terminal.
    if (prediction.status === "starting" || prediction.status === "processing") {
      prediction = await this.pollUntilTerminal(prediction, authHeader);
    }

    if (prediction.status === "failed" || prediction.status === "canceled") {
      throw new Error(
        `Replicate prediction ${prediction.status}: ${prediction.error ?? "unknown error"}`,
      );
    }

    const imageUrl = extractReplicateImageUrl(prediction.output);
    if (!imageUrl) {
      throw new Error(
        `Replicate prediction succeeded but produced no image URL: ${JSON.stringify(
          prediction,
        ).slice(0, 500)}`,
      );
    }

    return {
      imageUrl,
      mimeType: "image/jpeg",
      model,
      provider: "replicate",
      raw: prediction,
    };
  }

  /** Poll `urls.get` every ~2s up to ~60s until the prediction reaches a terminal status. */
  private async pollUntilTerminal(
    prediction: ReplicatePrediction,
    authHeader: string,
  ): Promise<ReplicatePrediction> {
    const getUrl = prediction.urls?.get;
    if (!getUrl) {
      throw new Error("Replicate prediction is pending but no urls.get was provided to poll.");
    }

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let current = prediction;

    while (current.status === "starting" || current.status === "processing") {
      if (Date.now() >= deadline) {
        throw new TransientProviderError(
          504,
          `Replicate prediction did not complete within ${POLL_TIMEOUT_MS}ms (last status: ${current.status}).`,
        );
      }

      await sleep(POLL_INTERVAL_MS);

      const pollRes = await fetch(getUrl, {
        method: "GET",
        headers: { Authorization: authHeader },
      });

      if (!pollRes.ok) {
        const text = await pollRes.text();
        if (pollRes.status === 429 || pollRes.status >= 500) {
          throw new TransientProviderError(pollRes.status, text);
        }
        throw new Error(`Replicate poll failed (${pollRes.status}): ${text}`);
      }

      current = (await pollRes.json()) as ReplicatePrediction;
    }

    return current;
  }
}

type ReplicateStatus = "starting" | "processing" | "succeeded" | "failed" | "canceled";

/** Shape of the relevant subset of a Replicate prediction object. */
interface ReplicatePrediction {
  status: ReplicateStatus;
  /** A single URL or an array of URLs depending on the model. */
  output?: string | string[] | null;
  error?: string | null;
  urls?: {
    get?: string;
    cancel?: string;
  };
  [key: string]: unknown;
}

/** Normalize Replicate `output` (string URL or array of URLs → first entry) to a URL. */
function extractReplicateImageUrl(output: ReplicatePrediction["output"]): string | undefined {
  if (typeof output === "string") {
    return output;
  }
  if (Array.isArray(output)) {
    const first = output.find((entry) => typeof entry === "string");
    return first;
  }
  return undefined;
}

/** Workers-runtime-safe delay built on the global `setTimeout`. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
