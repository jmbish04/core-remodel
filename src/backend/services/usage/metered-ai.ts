/**
 * @fileoverview Metered wrappers for the expensive bindings.
 *
 * Each wrapper does the same three things: check the breaker, run the call,
 * record the usage. Callers swap one import and get metering for free.
 *
 * WHY WRAPPERS RATHER THAN EDITING 130 CALL SITES. `env.AI.run` appears 130
 * times across 40 files. Rewriting all of them in one PR would be an unreviewable
 * diff, and most of those calls are cheap. These wrappers are adopted
 * incrementally, hottest path first — the showroom/brand research pipeline,
 * which is where the spend actually is.
 */

import { canSpend, recordUsage, type MeteredProvider } from "./metering";

/** Thrown when the breaker denies a call. Callers should not swallow it silently. */
export class SpendBlockedError extends Error {
  constructor(
    readonly provider: MeteredProvider,
    readonly spendUsd: number,
    readonly ceilingUsd: number,
    readonly reason: string,
  ) {
    super(
      `[metering] ${provider} blocked: $${spendUsd.toFixed(2)} of $${ceilingUsd.toFixed(2)} (${reason})`,
    );
    this.name = "SpendBlockedError";
  }
}

/** Throws SpendBlockedError when the provider is over its ceiling. */
export async function assertCanSpend(env: Env, provider: MeteredProvider): Promise<void> {
  const d = await canSpend(env, provider);
  if (!d.allowed) {
    throw new SpendBlockedError(provider, d.spendUsd, d.ceilingUsd, d.reason);
  }
}

/**
 * Workers AI usage lives on the response envelope for most models, but the
 * shape varies. Read defensively — an unreported token count records null
 * rather than a fabricated 0, so "we don't know" stays distinguishable from
 * "it was free".
 */
function readWorkersAiUsage(raw: unknown): {
  promptTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
} {
  const u = (raw as { usage?: Record<string, unknown> } | null)?.usage;
  const n = (v: unknown): number | null => (typeof v === "number" ? v : null);
  return {
    promptTokens: n(u?.prompt_tokens),
    outputTokens: n(u?.completion_tokens),
    totalTokens: n(u?.total_tokens),
  };
}

/**
 * `env.AI.run` with the breaker in front and a usage row behind.
 *
 * Signature intentionally mirrors `env.AI.run` so adoption is a one-line change
 * at the call site.
 */
export async function meteredAiRun(
  env: Env,
  model: Parameters<typeof env.AI.run>[0],
  input: Parameters<typeof env.AI.run>[1],
  opts: { feature: string },
): Promise<unknown> {
  await assertCanSpend(env, "WORKERS_AI");
  const startedAt = Date.now();
  try {
    const raw = await env.AI.run(model, input);
    const usage = readWorkersAiUsage(raw);
    await recordUsage(env, {
      provider: "WORKERS_AI",
      model: String(model),
      feature: opts.feature,
      ...usage,
      latencyMs: Date.now() - startedAt,
      status: "ok",
    });
    return raw;
  } catch (err) {
    // A failed call still consumed quota on the provider side — record it, else
    // a retry storm is invisible in the ledger.
    // A failed call still took time and still consumed provider quota — record
    // both, else a slow-failure storm is invisible in the latency column.
    await recordUsage(env, {
      provider: "WORKERS_AI",
      model: String(model),
      feature: opts.feature,
      latencyMs: Date.now() - startedAt,
      status: "error",
      errorMessage: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
    });
    throw err;
  }
}

/**
 * Record one Browser Rendering call. Browser Run bills per request rather than
 * per token, so cost is a flat per-call estimate rather than a token readout.
 *
 * The ceiling that actually matters for Browser Run is the account-wide 10 req/s
 * and 120 concurrent browsers — this ledger is about dollars, not rate.
 */
export async function recordBrowserRun(
  env: Env,
  opts: { feature: string; url: string; status?: "ok" | "error"; errorMessage?: string },
): Promise<void> {
  await recordUsage(env, {
    provider: "BROWSER_RENDERING",
    model: "browser-rendering/snapshot",
    feature: opts.feature,
    status: opts.status ?? "ok",
    errorMessage: opts.errorMessage ?? null,
    costUsd: BROWSER_RUN_COST_PER_CALL_USD,
    meta: { url: opts.url },
  });
}

/**
 * Flat per-call estimate. Browser Rendering is billed per request; this is a
 * placeholder rate so the ledger has a dollar figure to sum. Tune it from the
 * real invoice rather than guessing again.
 */
export const BROWSER_RUN_COST_PER_CALL_USD = 0.0005;
