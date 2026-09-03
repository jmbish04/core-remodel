/**
 * @fileoverview Shared CSLB compliance-gate VERDICT logic — the pass/fail/warn
 * math for the two gates that are pure arithmetic over data this Worker
 * already has (`down_payment_cap`, `license_active`), plus the numeric
 * constants behind them.
 *
 * Two call sites need this, and both must agree on the verdict for the same
 * contract or the dashboard lies to the user:
 *   - `routes/budget-compliance.ts` (`GET /api/budget/compliance`) — renders
 *     the full gate card with human-readable evidence text.
 *   - `routes/budget-workbench.ts` (`GET /api/budget/workbench-summary`,
 *     `GET /api/budget/inbox`) — counts failing/warning gates for the header
 *     badge and decision pill, and ranks them in the decision inbox.
 *
 * Deliberately scoped to VERDICTS + constants only, not evidence-text
 * rendering (that stays local to budget-compliance.ts, which owns the
 * gate-card UI shape). `budget-compliance.ts` is owned by a different agent
 * in this epic and currently has its own copy of this math with its own
 * evidence-string formatting — see the report for the note asking it to
 * import `capForContractCents` / `downPaymentCapVerdict` /
 * `licenseActiveVerdict` from here instead of keeping a second copy.
 */

/** CA Business & Professions Code §7159.5 flat-dollar alternative to the 10% cap. */
export const DOWN_PAYMENT_FLAT_CAP_CENTS = 100_000;

/** How far ahead of expiry a license starts reading as "warn" rather than "pass". */
export const LICENSE_WARN_WINDOW_SECONDS = 60 * 24 * 60 * 60; // 60 days

export type GateVerdict = "pass" | "fail" | "warn" | "na";

/**
 * The CSLB down-payment cap: the LESSER of $1,000 or 10% of the contract
 * price. Integer-cents only — 10% via floor(contractValueCents / 10), never
 * a float multiply. Flooring rounds the cap DOWN, the conservative (more
 * strict) direction. SQLite's integer division on two non-negative integers
 * truncates the same way, so a raw-SQL `min(100000, contractValueCents / 10)`
 * expression (used for counting/ranking in budget-workbench.ts) matches this
 * function exactly for non-negative inputs.
 */
export function capForContractCents(contractValueCents: number): number {
  return Math.min(DOWN_PAYMENT_FLAT_CAP_CENTS, Math.floor(contractValueCents / 10));
}

/**
 * `na` when either dollar figure is missing (never fabricated as pass). This
 * gate has no `warn` state — a down payment either respects the cap or it
 * doesn't.
 */
export function downPaymentCapVerdict(
  contractValueCents: number | null,
  depositAmountCents: number | null,
): GateVerdict {
  if (contractValueCents == null || depositAmountCents == null) return "na";
  return depositAmountCents > capForContractCents(contractValueCents) ? "fail" : "pass";
}

/** `na` with no license-expiry date on file — never fabricated as pass. */
export function licenseActiveVerdict(licenseExpiresAt: Date | null, nowMs: number): GateVerdict {
  if (!licenseExpiresAt) return "na";
  const msLeft = licenseExpiresAt.getTime() - nowMs;
  if (msLeft < 0) return "fail";
  if (msLeft <= LICENSE_WARN_WINDOW_SECONDS * 1000) return "warn";
  return "pass";
}
