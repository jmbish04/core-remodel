import { getCloudflareAccountId, getFalApiKey } from "../../../utils/secrets";
import type { StageProvider } from "../stage-provider";
import { TransientProviderError } from "../types";
import type { StageInput, StageOutput } from "../types";

/**
 * Fal image-model provider, routed through the Cloudflare AI Gateway native `/fal`
 * provider path (never the raw `https://fal.run` host).
 *
 * NOTE: The exact Fal model slugs (e.g. `fal-ai/flux-2-pro/edit`, `bria/fibo-edit/edit`,
 * `fal-ai/nano-banana-pro/edit`, `fal-ai/flux-pro/kontext`, `fal-ai/fast-sdxl`) and their
 * per-model input field names are TO BE VERIFIED against the live Fal catalog. The body
 * mapping below uses Fal's common conventions (`prompt`, `image_url`, `image_urls`,
 * `mask_url`) but individual models may expect different/extra fields.
 */
export class FalStageProvider implements StageProvider {
  readonly name = "fal" as const;

  async run(input: StageInput, env: Env): Promise<StageOutput> {
    const model = input.model;
    if (!model) {
      throw new Error("FalStageProvider requires input.model (a Fal model slug).");
    }

    const [falKey, accountId] = await Promise.all([
      getFalApiKey(env),
      getCloudflareAccountId(env),
    ]);

    if (!accountId) {
      throw new Error("CLOUDFLARE_ACCOUNT_ID is not configured for the AI Gateway.");
    }

    // Gateway base is unauthenticated here (matching the working Gemini path): we do
    // NOT add a `cf-aig-authorization` header.
    const gatewayBase = `https://gateway.ai.cloudflare.com/v1/${accountId}/${env.AI_GATEWAY_ID}`;
    const url = `${gatewayBase}/fal/${model}`;

    // Build the Fal request body. `sync_mode: true` makes Fal return the result inline
    // rather than a queued job handle.
    const body: Record<string, unknown> = {
      prompt: input.prompt,
      sync_mode: true,
    };

    // Multi-image synthesis (e.g. Stage 5) takes precedence over a single edit image.
    // Field names (`image_urls` vs `image_url`, `mask_url`) are TO BE VERIFIED per model.
    if (input.imageUrls && input.imageUrls.length > 0) {
      body.image_urls = input.imageUrls;
    } else {
      body.image_url = input.inputImageUrl;
    }

    if (input.maskUrl) {
      body.mask_url = input.maskUrl;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Key ${falKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      // Transient faults (rate limit / upstream 5xx) → let the failover layer step down.
      if (res.status === 429 || res.status >= 500) {
        throw new TransientProviderError(res.status, text);
      }
      throw new Error(`Fal request failed (${res.status}): ${text}`);
    }

    const raw = (await res.json()) as FalResponse;
    const imageUrl = extractFalImageUrl(raw);
    if (!imageUrl) {
      throw new Error(
        `Fal response did not contain an image URL: ${JSON.stringify(raw).slice(0, 500)}`,
      );
    }

    return {
      imageUrl,
      mimeType: "image/jpeg",
      model,
      provider: "fal",
      raw,
    };
  }
}

/** Shape of the relevant subset of a Fal generation response. */
interface FalImage {
  url?: string;
}

interface FalResponse {
  /** Most Fal image models return an `images` array. */
  images?: FalImage[];
  /** Some models return a single `image` object instead. */
  image?: FalImage;
  [key: string]: unknown;
}

/** Pull the first usable image URL from a Fal response (`images[0].url` or `image.url`). */
function extractFalImageUrl(raw: FalResponse): string | undefined {
  const fromArray = raw.images?.find((img) => typeof img?.url === "string")?.url;
  if (fromArray) {
    return fromArray;
  }
  if (typeof raw.image?.url === "string") {
    return raw.image.url;
  }
  return undefined;
}
