import type { ProviderName, StageInput, StageOutput } from "./types";

/**
 * Provider-agnostic interface for one generation call. Every implementation routes
 * through Cloudflare AI Gateway (Gemini google-ai-studio path, Fal /fal, Replicate
 * /replicate) — never a raw vendor host.
 *
 * Implementations should throw `TransientProviderError` on 429/5xx so the failover
 * layer can step down to a sibling model; other errors propagate as fatal.
 */
export interface StageProvider {
  readonly name: ProviderName;
  run(input: StageInput, env: Env): Promise<StageOutput>;
}
