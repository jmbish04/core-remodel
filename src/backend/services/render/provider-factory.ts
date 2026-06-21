import { FalStageProvider } from "./providers/fal-stage-provider";
import { GeminiStageProvider } from "./providers/gemini-stage-provider";
import { ReplicateStageProvider } from "./providers/replicate-stage-provider";
import type { StageProvider } from "./stage-provider";
import type { ProviderName } from "./types";

const PROVIDERS: Record<ProviderName, StageProvider> = {
  gemini: new GeminiStageProvider(),
  fal: new FalStageProvider(),
  replicate: new ReplicateStageProvider(),
};

export function getProvider(name: ProviderName): StageProvider {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown render provider: ${name}`);
  return provider;
}
