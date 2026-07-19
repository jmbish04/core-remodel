/**
 * @fileoverview Showroom Scout — model factory.
 *
 * The OpenAI Agents SDK owns the agent loop; the *model* underneath is
 * swappable. We bridge via `aisdk()` from `@openai/agents-extensions`, which
 * accepts any Vercel AI SDK provider, so the same agent runs on Gemini or
 * Workers AI without touching agent code.
 *
 * Version constraint (checked, not assumed): `@openai/agents-extensions@0.13.5`
 * peer-depends on `@ai-sdk/provider ^2 || ^3`, and `ai@6` ships `@ai-sdk/provider@3`.
 * `@ai-sdk/google@4.x` jumped to `@ai-sdk/provider@4` and is therefore NOT
 * compatible with the adapter — this project pins `@ai-sdk/google@3.0.95`.
 * Bumping that major will break the bridge silently. Keep them in step.
 */
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { aisdk } from "@openai/agents-extensions/ai-sdk";
import { createWorkersAI } from "workers-ai-provider";

export type ScoutProvider = "gemini" | "workers-ai";

/** Defaults chosen so the agent works with zero extra config. */
const DEFAULT_MODEL: Record<ScoutProvider, string> = {
  gemini: "gemini-2.5-flash",
  "workers-ai": "@cf/zai-org/glm-4.7-flash",
};

/**
 * Resolve which provider/model to run.
 *
 * `SHOWROOM_SCOUT_PROVIDER` and `SHOWROOM_SCOUT_MODEL` are plain vars (not
 * secrets) so they can be flipped in `wrangler.jsonc` without a redeploy of
 * secret material.
 */
export function resolveScoutModelConfig(env: Env): { provider: ScoutProvider; model: string } {
  // `wrangler types` narrows vars to their configured literal, so compare as
  // plain strings — the value is overridable per-environment at deploy time.
  const raw = String(env.SHOWROOM_SCOUT_PROVIDER ?? "");
  const provider: ScoutProvider = raw === "workers-ai" ? "workers-ai" : "gemini";
  const model = String(env.SHOWROOM_SCOUT_MODEL || DEFAULT_MODEL[provider]);
  return { provider, model };
}

/**
 * Build the Agents-SDK-compatible model for the scout loop.
 *
 * NOTE ON GROUNDING: we deliberately do NOT attach Google Search grounding to
 * this model. Google only supports combining built-in tools (search) with
 * custom function declarations on Gemini 3; on 2.5 the request does not cleanly
 * fail — it silently misbehaves. Since the scout loop is function-tool-heavy,
 * grounded search lives in its own isolated, tool-free call
 * (`tools/web-search.ts`). That keeps this factory model-agnostic.
 */
export async function createScoutModel(env: Env) {
  const { provider, model } = resolveScoutModelConfig(env);

  if (provider === "workers-ai") {
    const workersai = createWorkersAI({
      binding: env.AI,
      gateway: { id: env.AI_GATEWAY_ID },
    });
    return aisdk(workersai(model as Parameters<typeof workersai>[0]));
  }

  const apiKey = await env.GEMINI_API_KEY.get();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured — Showroom Scout cannot start");
  const google = createGoogleGenerativeAI({ apiKey });
  return aisdk(google(model));
}
