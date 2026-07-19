/**
 * @fileoverview Showroom Scout — model retry policy.
 *
 * Found live: Gemini returned `503 UNAVAILABLE` mid-run and the entire scouting
 * session died, discarding ~15 completed searches. The provider itself flagged
 * the error `isRetryable: true`.
 *
 * The Agents SDK does NOT retry by default — `modelSettings.retry` is opt-in and
 * inert unless a policy explicitly returns true. A user replanning from the car
 * must not lose their route to a transient upstream blip.
 *
 * Scope note: this covers failures of the *model* request. Tool failures are
 * handled separately in `mcp-bridge.ts`, which returns the error to the model as
 * a readable string so it can route around the gap.
 */
import type { ModelRetrySettings, RetryPolicyContext } from "@openai/agents";

/** Transient by nature: rate limits and the 5xx family. */
function isTransientStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

/**
 * Retry transient model failures, never deterministic ones.
 *
 * A 400 (bad schema), 401/403 (bad key) or 404 (bad model id) will fail
 * identically on every attempt — retrying those just burns the user's time and
 * hides a real configuration bug behind a delay.
 */
export const scoutRetryPolicy = (context: RetryPolicyContext) => {
  const { normalized, providerAdvice } = context;

  // An aborted request was cancelled deliberately — never resurrect it.
  if (normalized.isAbort) return { retry: false, reason: "aborted" };

  // The provider is the best judge of its own replay safety.
  if (providerAdvice?.replaySafety === "unsafe") {
    return { retry: false, reason: "provider marked replay unsafe" };
  }

  if (normalized.isNetworkError) {
    return { retry: true, reason: "network error" };
  }

  if (isTransientStatus(normalized.statusCode)) {
    return {
      retry: true,
      // Honour Retry-After when the provider sends one; otherwise fall through
      // to the configured exponential backoff.
      delayMs: normalized.retryAfterMs,
      reason: `transient status ${normalized.statusCode}`,
    };
  }

  if (providerAdvice?.suggested === true) {
    return { retry: true, delayMs: providerAdvice.retryAfterMs, reason: "provider suggested retry" };
  }

  return { retry: false, reason: `non-retryable (status ${normalized.statusCode ?? "unknown"})` };
};

/**
 * Retry settings for the scout loop.
 *
 * Three attempts with jittered exponential backoff. Kept modest deliberately:
 * a Worker request has a wall-clock budget, and a long retry ladder on a dead
 * upstream is worse for the user than failing fast with a clear message.
 */
export const SCOUT_RETRY: ModelRetrySettings = {
  maxRetries: 3,
  backoff: {
    initialDelayMs: 1_000,
    maxDelayMs: 15_000,
    multiplier: 2,
    // Jitter matters: without it, every in-flight agent retries in lockstep and
    // re-hammers an already-struggling upstream at the same instant.
    jitter: true,
  },
  policy: scoutRetryPolicy,
};
