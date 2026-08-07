/**
 * @fileoverview 0035 budget grid — pure client-side VIEW math.
 *
 * The three views (Estimate / Actuals / Variance) and the footer rollups are
 * computed in the browser from the raw `plan[]` / `actual[]` cent arrays the
 * `GET /api/budget/grid` API returns (see `BudgetGridApp.tsx`). This module
 * holds ONLY that pure math + formatting so it can be exercised by a standalone
 * assert self-check outside any bundle — no React, no imports, no side effects.
 *
 * Self-check: `npx tsx scripts/tests/test_budget_grid_view.mjs` (assertions
 * live there, not here, so nothing test-only ships in the frontend island —
 * same pattern as scripts/tests/test_budget_grid_math.mjs for the backend).
 */

export type View = "estimate" | "actuals" | "variance";

/** Semantic tone for a rendered cell; the component maps these to color classes. */
export type CellTone = "plain" | "zero" | "pos" | "neg";

export type FormattedCell = { text: string; tone: CellTone };

/** Round integer cents to whole dollars with thousands separators, no cents, no sign. */
export function formatUsd(cents: number): string {
  const dollars = Math.round(Math.abs(cents) / 100);
  return `$${dollars.toLocaleString("en-US")}`;
}

/** Signed whole-dollar string, e.g. "+$1,234" / "-$1,234" / "$0". */
export function formatSignedUsd(cents: number): string {
  if (cents === 0) return "$0";
  return `${cents > 0 ? "+" : "-"}${formatUsd(cents)}`;
}

/** The numeric value a cell shows for the active view (in cents). */
export function cellValue(view: View, planCents: number, actualCents: number): number {
  if (view === "estimate") return planCents;
  if (view === "actuals") return actualCents;
  return planCents - actualCents; // variance: favorable = positive (under budget)
}

/**
 * Format one grid cell for the active view.
 * - Estimate / Actuals: `$1,234`; a zero reads as a faint `$0`.
 * - Variance: `+$1,234` (favorable/under budget) / `($1,234)` (over budget) / `—` (flat).
 */
export function formatCell(view: View, planCents: number, actualCents: number): FormattedCell {
  const value = cellValue(view, planCents, actualCents);
  if (view === "variance") {
    if (value === 0) return { text: "—", tone: "zero" };
    if (value > 0) return { text: `+${formatUsd(value)}`, tone: "pos" };
    return { text: `(${formatUsd(value)})`, tone: "neg" };
  }
  if (value === 0) return { text: "$0", tone: "zero" };
  return { text: formatUsd(value), tone: "plain" };
}

function cumulative(values: number[]): number[] {
  const out: number[] = [];
  let running = 0;
  for (const v of values) {
    running += v;
    out.push(running);
  }
  return out;
}

/**
 * Available budget per month = funding − cumulative actual burn up to and
 * including that month. Always driven by ACTUAL burn, regardless of the active
 * view (per the reference `support.js`).
 */
export function availableBudget(fundingCents: number, monthActualTotals: number[]): number[] {
  return cumulative(monthActualTotals).map((spentSoFar) => fundingCents - spentSoFar);
}

/** Net burn per month = −(that month's actual total). Money out reads negative. */
export function netBurn(monthActualTotals: number[]): number[] {
  return monthActualTotals.map((total) => -total);
}

/** Cumulative variance per month = running Σ (plan − actual). */
export function cumulativeVariance(
  monthPlanTotals: number[],
  monthActualTotals: number[],
): number[] {
  return cumulative(monthPlanTotals.map((plan, i) => plan - (monthActualTotals[i] ?? 0)));
}

/** Monthly variance per month = plan − actual for that month. */
export function monthlyVariance(monthPlanTotals: number[], monthActualTotals: number[]): number[] {
  return monthPlanTotals.map((plan, i) => plan - (monthActualTotals[i] ?? 0));
}
