/**
 * @fileoverview PURE circuit-breaker decision logic. No imports, by design.
 *
 * Split from `metering.ts` (which imports drizzle and the schema barrel) so the
 * rules can be unit-tested with plain `node` — a bare node process cannot
 * resolve the `@backend` alias. Same split as `showroom-category-rules.ts`.
 *
 * Keeping the decision here rather than mirroring it in the test matters: a
 * mirrored copy drifts silently, and the thing being protected is spend.
 */

export type BreakerReason = "ok" | "manual_break" | "over_threshold" | "read_error";

export interface BreakerInput {
  /** Manual break-glass — denies regardless of spend. */
  manualBreak: boolean;
  /** Raised ceiling that supersedes the threshold until reached. Null = none. */
  snoozeToUsd: number | null;
  /** Configured ceiling in USD. 0 = unconfigured (allows). */
  thresholdUsd: number;
  /** Spend so far this cycle, USD. */
  spendUsd: number;
}

export interface BreakerDecision {
  allowed: boolean;
  reason: BreakerReason;
  /** The ceiling actually applied (snooze wins over threshold). */
  ceilingUsd: number;
}

/**
 * Decide whether a provider may spend.
 *
 * A read failure is NOT represented here — the caller returns `read_error`
 * before reaching this function, because failing closed on an unreadable ledger
 * is a policy decision, not arithmetic.
 */
export function decideSpend(input: BreakerInput): BreakerDecision {
  if (input.manualBreak) {
    return { allowed: false, reason: "manual_break", ceilingUsd: input.thresholdUsd };
  }
  // A snooze REPLACES the ceiling until spend reaches it, then trips again.
  const ceilingUsd = input.snoozeToUsd !== null ? input.snoozeToUsd : input.thresholdUsd;
  // 0 means "no ceiling configured" — allow, though it is not a recommended state.
  const allowed = ceilingUsd <= 0 ? true : input.spendUsd < ceilingUsd;
  return { allowed, reason: allowed ? "ok" : "over_threshold", ceilingUsd };
}

/**
 * Start of the current billing cycle for an anchor day-of-month.
 *
 * Anchored rather than calendar-month because a real billing cycle rarely starts
 * on the 1st. Clamped to 1-28 so the anchor exists in every month — a 29th/30th/
 * 31st anchor would silently skip February.
 */
export function cycleStart(anchorDay: number, now: Date = new Date()): Date {
  const day = Math.min(Math.max(Math.trunc(anchorDay) || 1, 1), 28);
  // UTC, NOT local time. `gemini_usage_log.timestamp` defaults to
  // `(unixepoch())`, which is UTC, so a local-time boundary would shift the
  // cycle by the host offset — silently misattributing spend near midnight and
  // producing different answers on a dev machine than in the Worker.
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 0, 0, 0, 0),
  );
  if (now.getTime() < start.getTime()) {
    // Before this month's anchor — the cycle began last month.
    start.setUTCMonth(start.getUTCMonth() - 1);
  }
  return start;
}
