/**
 * Failover / step-down: try the primary model; on a transient (429/5xx) provider
 * fault, retry with the next sibling model (possibly cross-provider). Fatal (4xx
 * schema) errors propagate — never masked behind a fallback. Prefer AI Gateway
 * native retries for same-tier resilience; this handles cross-tier step-down.
 */
import type { ModelChoice } from "./model-registry";
import { getProvider } from "./provider-factory";
import { TransientProviderError, type StageInput, type StageOutput } from "./types";

export interface FailoverResult {
  output: StageOutput;
  resolvedModel: string;
  provider: string;
  fallbackTriggered: boolean;
}

export async function runWithFailover(
  baseInput: StageInput,
  primary: ModelChoice,
  alternates: ModelChoice[],
  env: Env,
): Promise<FailoverResult> {
  const chain = [primary, ...alternates];
  let lastErr: unknown;

  for (let i = 0; i < chain.length; i++) {
    const choice = chain[i];
    const input: StageInput = { ...baseInput, model: choice.model };
    try {
      const output = await getProvider(choice.provider).run(input, env);
      return {
        output,
        resolvedModel: choice.model,
        provider: choice.provider,
        fallbackTriggered: i > 0,
      };
    } catch (err) {
      lastErr = err;
      if (err instanceof TransientProviderError) {
        continue; // step down to the next sibling model
      }
      throw err; // fatal — surface it
    }
  }

  throw lastErr ?? new Error("All render providers failed");
}
