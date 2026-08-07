import type { DrizzleD1Database } from "drizzle-orm/d1";

import {
  computeGridMath,
  deriveMonthWindow,
  secondsToMonth,
  type GridMonth,
  type GridPhase,
} from "@backend/api/routes/budget-grid-math";
/**
 * @fileoverview 0035 time-phased budget grid — shared load function.
 *
 * Single source of truth for turning normalized grid-query params into the
 * grid response object (months/phases/footer/scorecards). Extracted out of
 * `GET /api/budget/grid` (`src/backend/api/routes/budget-grid.ts`) so the
 * `get_budget_grid` MCP tool (`src/backend/mcp/tools/budget/get_budget_grid.ts`)
 * can read the exact same grid a chat session would see there — no second
 * copy of the SQL/aggregation wiring. I/O only: read D1, shape into the pure
 * `budget-grid-math.ts` helper, shape its output into the response envelope.
 * The route's external behavior (query params, validation, response shape)
 * is unchanged by this extraction.
 */
import {
  budgetExpenseEntries,
  budgetFundingAccounts,
  budgetPhases,
  budgetPlanSchedule,
  budgetTrackerItems,
} from "@backend/db";
import { eq } from "drizzle-orm";

/** 'YYYY-MM' — exported so callers (route + MCP tool) validate with the same regex. */
export const PERIOD_RE = /^\d{4}-\d{2}$/;

export type LoadBudgetGridOptions = {
  /** 'YYYY-MM', already validated against PERIOD_RE by the caller. */
  from?: string | null;
  /** 'YYYY-MM', already validated against PERIOD_RE by the caller. */
  to?: string | null;
  /** Numeric phase id as a string (0 = Unphased), or 'all'/null/undefined for no filter. */
  phase?: string | null;
  q?: string | null;
};

export type BudgetGrid = {
  months: GridMonth[];
  phases: GridPhase[];
  footer: {
    fundingCents: number;
    monthPlanTotals: number[];
    monthActualTotals: number[];
  };
  scorecards: {
    totalBudgetCents: number;
    spentCents: number;
    remainingCents: number;
    estimateCents: number;
    varianceCents: number;
    pctUsed: number;
    lineItemCount: number;
    phaseCount: number;
  };
};

/**
 * Fill every 'YYYY-MM' between from and to inclusive (from <= to), no cap.
 * Exported (in addition to being used internally by `loadBudgetGrid`) so it
 * can be exercised directly by `scripts/tests/test_budget_grid_service.mjs` —
 * this is the pure piece of the window logic; the surrounding one-sided-bound
 * extension in `loadBudgetGrid` needs live `periodsPresent` data to test
 * meaningfully and is covered there by inline reasoning per the brief.
 */
export function fillMonthRange(from: string, to: string): string[] {
  if (!PERIOD_RE.test(from) || !PERIOD_RE.test(to)) return [];
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  const months: string[] = [];
  let cursor = lo;
  // Bail out past a sane ceiling so a malformed pair can't loop forever.
  let guard = 0;
  while (cursor <= hi && guard < 1000) {
    months.push(cursor);
    const [y, m] = cursor.split("-").map(Number);
    const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    cursor = next;
    guard += 1;
  }
  return months;
}

/**
 * Load the time-phased budget grid for the given query params. Mirrors
 * exactly what `GET /api/budget/grid` returns under its `grid` key.
 *
 * Generic over `TSchema` (rather than pinned to the default
 * `DrizzleD1Database<Record<string, never>>`) because `ReturnType<typeof
 * drizzle>` — used for `RemodelDb` in the MCP tool layer — resolves the
 * schema type param against its constraint, not its default, so a caller's
 * `db` client can arrive typed as `DrizzleD1Database<Record<string,
 * unknown>>` instead. Both the route's `drizzle(c.env.DB)` and the MCP
 * transport's `drizzle(this.env.DB)` call sites are schema-less either way.
 */
export async function loadBudgetGrid<
  TSchema extends Record<string, unknown> = Record<string, never>,
>(db: DrizzleD1Database<TSchema>, options: LoadBudgetGridOptions = {}): Promise<BudgetGrid> {
  const fromParam = options.from ?? null;
  const toParam = options.to ?? null;
  const phaseParam = options.phase ?? null;
  const qParam = options.q ?? null;

  const [items, phaseDefs, planRows, expenseRows, fundingAccounts] = await Promise.all([
    db.select().from(budgetTrackerItems).where(eq(budgetTrackerItems.isActive, true)).all(),
    db
      .select()
      .from(budgetPhases)
      .where(eq(budgetPhases.isActive, true))
      .orderBy(budgetPhases.sortOrder)
      .all(),
    db.select().from(budgetPlanSchedule).all(),
    db.select().from(budgetExpenseEntries).where(eq(budgetExpenseEntries.isActive, true)).all(),
    db.select().from(budgetFundingAccounts).all(),
  ]);

  // --- Month window ---
  // Collected once, up front: every period present in the plan schedule
  // plus every expense's dateIncurred month, across the WHOLE dataset (not
  // phase/q-filtered — the window brief describes is data-wide).
  const periodsPresent: string[] = planRows.map((row) => row.period);
  for (const expense of expenseRows) {
    if (expense.dateIncurred) {
      periodsPresent.push(secondsToMonth(Math.floor(expense.dateIncurred.getTime() / 1000)));
    }
  }

  let months: string[];
  if (fromParam && toParam) {
    // Explicit bounds are never truncated to the 12-month cap — that cap
    // only applies to the derived-from-data windows below.
    months = fillMonthRange(fromParam, toParam);
  } else if (fromParam) {
    // Only a lower bound given: extend the upper bound OUT to the data's
    // latest period (never just a single degenerate month), capped to 12.
    const forward = periodsPresent.filter((p) => p >= fromParam).sort();
    const to = forward.length > 0 ? forward[forward.length - 1] : fromParam;
    months = fillMonthRange(fromParam, to).slice(0, 12);
  } else if (toParam) {
    // Only an upper bound given: extend the lower bound BACK to the data's
    // earliest period, capped to the most recent 12 months ending at `to`.
    const backward = periodsPresent.filter((p) => p <= toParam).sort();
    const from = backward.length > 0 ? backward[0] : toParam;
    const filled = fillMonthRange(from, toParam);
    months = filled.length > 12 ? filled.slice(filled.length - 12) : filled;
  } else {
    months = deriveMonthWindow(periodsPresent, 12);
    // ponytail: brief allows an empty `months` array as the "no data at all"
    // fallback instead of a Date.now()-derived 5-month default, to keep this
    // function deterministic. See task-1-brief.md "Month window".
  }

  const gridInput = {
    months,
    items: items.map((row) => ({
      id: row.id,
      trackId: row.trackId,
      label: row.title,
      phaseId: row.phaseId,
      varianceNoteMarkdown: row.varianceNoteMarkdown,
    })),
    phaseDefs: phaseDefs.map((row) => ({
      id: row.id,
      name: row.name,
      tone: row.tone,
      sortOrder: row.sortOrder,
    })),
    planRows: planRows.map((row) => ({
      budgetItemTrackId: row.budgetItemTrackId,
      period: row.period,
      plannedCents: row.plannedCents,
    })),
    expenseRows: expenseRows.map((row) => ({
      budgetItemTrackId: row.budgetItemTrackId,
      amountCents: row.amountCents,
      dateIncurred: row.dateIncurred ? Math.floor(row.dateIncurred.getTime() / 1000) : null,
    })),
    phaseFilter: phaseParam,
    q: qParam,
  };

  const { months: monthOut, phases } = computeGridMath(gridInput);

  const monthPlanTotals = Array.from({ length: monthOut.length }, () => 0);
  const monthActualTotals = Array.from({ length: monthOut.length }, () => 0);
  for (const phase of phases) {
    for (let i = 0; i < monthOut.length; i += 1) {
      // Guard against a phase array shorter than the month window — a missing
      // cell must read as 0, never turn the whole footer total into NaN.
      monthPlanTotals[i] += phase.plan[i] ?? 0;
      monthActualTotals[i] += phase.actual[i] ?? 0;
    }
  }

  // --- Scorecards: whole project, independent of from/to/phase/q ---
  const totalBudgetCents = fundingAccounts.reduce((sum, row) => sum + row.amountCents, 0);
  const spentCents = expenseRows.reduce((sum, row) => sum + row.amountCents, 0);
  const remainingCents = totalBudgetCents - spentCents;
  const estimateCents = planRows.reduce((sum, row) => sum + row.plannedCents, 0);
  const varianceCents = estimateCents - spentCents;
  const pctUsed = totalBudgetCents > 0 ? Math.round((100 * spentCents) / totalBudgetCents) : 0;

  return {
    months: monthOut,
    phases,
    footer: {
      fundingCents: totalBudgetCents,
      monthPlanTotals,
      monthActualTotals,
    },
    scorecards: {
      totalBudgetCents,
      spentCents,
      remainingCents,
      estimateCents,
      varianceCents,
      pctUsed,
      lineItemCount: items.length,
      phaseCount: phaseDefs.length,
    },
  };
}
