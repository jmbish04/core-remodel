/**
 * Per-stage model registry (config-driven). v1 defaults to Gemini 3 Pro Image
 * everywhere (proven, already wired via AI Gateway, no extra secret needed).
 * Fal/Replicate alternates are config-selectable once those providers are wired
 * (Phase 4) and are also the failover step-down targets.
 *
 * NOTE: Fal/Replicate slugs are TO BE VERIFIED against the live catalogs before use.
 */
import type { ProviderName, StageType } from "./types";

export type RegistryStageKey =
  | "base"
  | "rough_in"
  | "finish"
  | "interaction"
  | "synthesis";

export interface ModelChoice {
  provider: ProviderName;
  model: string;
}

export const DEFAULT_MODEL_REGISTRY: Record<RegistryStageKey, ModelChoice> = {
  base: { provider: "gemini", model: "gemini-3-pro-image" },
  rough_in: { provider: "gemini", model: "gemini-3-pro-image" },
  finish: { provider: "gemini", model: "gemini-3-pro-image" },
  interaction: { provider: "gemini", model: "gemini-3-pro-image" },
  synthesis: { provider: "gemini", model: "gemini-3-pro-image" },
};

/** Gateway-native alternates for A/B selection and failover step-down. */
export const ALTERNATE_MODELS: Record<RegistryStageKey, ModelChoice[]> = {
  base: [{ provider: "fal", model: "bria/fibo-edit/edit" }],
  rough_in: [
    { provider: "replicate", model: "black-forest-labs/flux-depth-pro" },
    { provider: "fal", model: "fal-ai/fast-sdxl" },
  ],
  finish: [
    { provider: "replicate", model: "black-forest-labs/flux-kontext-max" },
    { provider: "fal", model: "fal-ai/flux-pro/kontext" },
  ],
  interaction: [{ provider: "fal", model: "fal-ai/nano-banana-pro/edit" }],
  synthesis: [{ provider: "fal", model: "fal-ai/flux-2-pro/edit" }],
};

/** Resolve a stage type / branching op to its registry key. */
export function stageKeyForType(type: StageType): RegistryStageKey {
  switch (type) {
    case "stage_1_LP_base":
      return "base";
    case "stage_2_LP_rough_in":
      return "rough_in";
    case "stage_5_LP_synthesis":
      return "synthesis";
    case "stage_3_LP_finish":
    case "stage_1_IP_finish":
      return "finish";
    default:
      // stage_0 nodes are inputs/extraction (no model gen); default to finish.
      return "finish";
  }
}

/** The default model for a stage type. */
export function defaultModelForStage(type: StageType): ModelChoice {
  return DEFAULT_MODEL_REGISTRY[stageKeyForType(type)];
}
