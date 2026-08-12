/**
 * @fileoverview KV read-through cache for the spend breaker's decision.
 *
 * WHY THIS EXISTS. `canSpend()` is correct but not cheap: every call issues two
 * D1 queries — one for the whole metering config, and one `SUM(estimated_cost_usd)`
 * over `gemini_usage_log`, which is append-only and only ever grows. That is an
 * acceptable price on an admin page. It is not an acceptable price in front of
 * every AI call, which is exactly where the breaker has to sit to be worth
 * anything. A brake nobody can afford to press is not a brake.
 *
 * So the decision — not the ledger — is cached in KV. One `CACHE.get` replaces
 * the two D1 queries on the hot path.
 *
 * WHAT IS AND IS NOT AUTHORITATIVE
 * --------------------------------
 * D1 stays the source of truth for both halves: `project_system_variables` holds
 * the config, `gemini_usage_log` holds the spend. KV holds a short-lived copy of
 * the ANSWER. Nothing is ever incremented in KV — Workers KV has no atomic
 * increment, so a counter kept there would silently lose concurrent writes and
 * under-report spend, which is the one direction a spend guard must never err
 * in. Recomputing from D1 on expiry cannot drift.
 *
 * THE STALENESS CEILING IS ASYMMETRIC, ON PURPOSE
 * -----------------------------------------------
 * A cached ALLOW is the risky one: it can let spending continue for up to its
 * TTL after the real limit was crossed. A cached DENY is free — the breaker is
 * already open and re-deriving that from D1 every time buys nothing. So allow is
 * cached briefly and deny is cached for much longer.
 *
 * ponytail: bounded-staleness cache, no atomic counter. If ALLOW_TTL_SECONDS of
 * overspend ever becomes material, the upgrade is a Durable Object holding the
 * counter (single-threaded, so increments are atomic) — not a longer TTL and not
 * a KV counter.
 *
 * ANY config write MUST call `invalidateBreakerCache`. A manual break that takes
 * a minute to bite is not a break-glass control.
 */

import type { MeteredProvider, SpendDecision } from "./metering";

/** Bump when the cached shape changes, so old entries are ignored not misread. */
const KEY_PREFIX = "usage:breaker:v2";

/**
 * How long an ALLOW may be reused. This is the maximum window in which spending
 * can continue past the ceiling, so it is deliberately short.
 */
const ALLOW_TTL_SECONDS = 30;

/**
 * How long a DENY may be reused. Longer because re-deriving "still over budget"
 * from D1 has no upside — and because the deny path is the one that runs hot
 * during exactly the runaway this exists to stop.
 */
const DENY_TTL_SECONDS = 300;

function cacheKey(provider: MeteredProvider): string {
  return `${KEY_PREFIX}:${provider}`;
}

/**
 * Read a cached decision. Returns null on miss, on a malformed entry, or when KV
 * is unavailable.
 *
 * A KV failure must never decide policy — it degrades to the D1 path, which has
 * its own (fail-closed) error handling. Swallowing the error here and returning
 * null is what makes that true.
 */
export async function readCachedDecision(
  env: Env,
  provider: MeteredProvider,
): Promise<SpendDecision | null> {
  if (!env.CACHE) return null;
  try {
    const raw = await env.CACHE.get(cacheKey(provider), "json");
    if (!raw || typeof raw !== "object") return null;
    const d = raw as Partial<SpendDecision>;
    // Validate rather than trust: a cache entry written by an older deploy with
    // a different shape would otherwise be read as `allowed: undefined`, which
    // is falsy — i.e. it would silently deny everything.
    if (typeof d.allowed !== "boolean" || typeof d.reason !== "string") return null;
    return {
      allowed: d.allowed,
      provider,
      spendUsd: typeof d.spendUsd === "number" ? d.spendUsd : 0,
      ceilingUsd: typeof d.ceilingUsd === "number" ? d.ceilingUsd : 0,
      reason: d.reason as SpendDecision["reason"],
    };
  } catch (err) {
    console.error(`[metering] breaker cache read failed for ${provider}:`, err);
    return null;
  }
}

/**
 * Cache a decision computed from D1. Never throws — a cache write failure just
 * means the next call pays for D1 again.
 *
 * `read_error` decisions are NOT cached: that outcome means D1 was unreadable,
 * and pinning a deny for five minutes because of one transient blip would turn a
 * momentary D1 hiccup into a five-minute outage of every metered feature.
 */
export async function writeCachedDecision(env: Env, decision: SpendDecision): Promise<void> {
  if (!env.CACHE) return;
  if (decision.reason === "read_error") return;
  try {
    await env.CACHE.put(cacheKey(decision.provider), JSON.stringify(decision), {
      expirationTtl: decision.allowed ? ALLOW_TTL_SECONDS : DENY_TTL_SECONDS,
    });
  } catch (err) {
    console.error(`[metering] breaker cache write failed for ${decision.provider}:`, err);
  }
}

/**
 * Drop cached decisions so the next check re-derives from D1.
 *
 * Called on every config write. Without it, raising a threshold or clearing a
 * manual break would not take effect until the TTL expired — and an operator
 * hitting "reset breaker" and watching nothing happen for five minutes will
 * reasonably conclude the control is broken.
 *
 * Omit `provider` to clear every provider (used when a global key such as the
 * cycle anchor day changes, which moves the spend window for all of them).
 */
export async function invalidateBreakerCache(env: Env, provider?: MeteredProvider): Promise<void> {
  if (!env.CACHE) return;
  const providers = provider ? [provider] : METERED_PROVIDERS_FOR_INVALIDATION;
  try {
    await Promise.all(providers.map((p) => env.CACHE.delete(cacheKey(p))));
  } catch (err) {
    console.error("[metering] breaker cache invalidation failed:", err);
  }
}

/**
 * Local copy of the provider list.
 *
 * Duplicated deliberately: importing `METERED_PROVIDERS` from `./metering` would
 * make this module and that one mutually dependent, and `metering` imports this
 * one for the read-through. Seven strings is a cheaper price than a cycle.
 */
const METERED_PROVIDERS_FOR_INVALIDATION: MeteredProvider[] = [
  "GEMINI",
  "WORKERS_AI",
  "BROWSER_RENDERING",
  "DURABLE_OBJECT",
  "VECTORIZE",
  "CF_IMAGES",
  "GOOGLE_PLACES",
];
