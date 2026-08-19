import { loadBudgetGrid, PERIOD_RE } from "@backend/services/budget/grid";
import { z } from "zod";

import { formatCents } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

const gridFlagShape = looseObject({
  type: z.enum(["destructive", "warning", "success"]),
  pct: z.number().describe("Variance percent, e.g. -12 for 12% under plan"),
  note: z.string().nullable(),
}).nullable();

const gridLineShape = looseObject({
  id: z.number().int(),
  trackId: z.string(),
  label: z.string(),
  plan: z.array(z.number().int()).describe("Planned cents, one entry per grid.months"),
  actual: z.array(z.number().int()).describe("Actual cents, one entry per grid.months"),
  flag: gridFlagShape,
});

const gridPhaseShape = looseObject({
  id: z.number().int().describe("0 = the synthetic 'Unphased' group"),
  name: z.string(),
  tone: z.string().nullable(),
  progressPct: z.number().int(),
  plan: z.array(z.number().int()),
  actual: z.array(z.number().int()),
  lines: z.array(gridLineShape),
});

export const getBudgetGrid = defineTool({
  name: "get_budget_grid",
  category: "budget",
  title: "Time-phased budget grid",
  description:
    "Read the same time-phased budget grid the /admin/budget grid page renders: months as columns, phases → line-items as rows, plan vs actual per month, per-phase progress and tone, per-line variance flags, footer month totals, and whole-project scorecards (funding/spent/remaining/estimate/variance, independent of any filter). Money is cents. `from`/`to` are 'YYYY-MM'; give both for an explicit inclusive range, one alone to extend toward the data in that direction (capped at 12 months), or neither to derive the window from the data (capped at the most recent 12 months; an empty grid is returned if there's no data at all yet). `phaseId` filters to one phase (0 = the synthetic 'Unphased' group); omit for every phase. `q` free-text filters line-item labels.",
  inputShape: {
    from: z
      .string()
      .regex(PERIOD_RE, "from must be YYYY-MM")
      .optional()
      .describe("Inclusive lower bound month, 'YYYY-MM'"),
    to: z
      .string()
      .regex(PERIOD_RE, "to must be YYYY-MM")
      .optional()
      .describe("Inclusive upper bound month, 'YYYY-MM'"),
    phaseId: z
      .number()
      .int()
      .optional()
      .describe("Filter to one phase id (0 = Unphased). Omit for all phases."),
    q: z.string().optional().describe("Free-text filter over line-item label"),
  },
  annotations: READ_ONLY,
  outputShape: {
    summary: z.string().describe("Human-readable one-line summary of the grid"),
    grid: looseObject({
      months: z.array(looseObject({ period: z.string(), label: z.string() })),
      phases: z.array(gridPhaseShape),
      footer: looseObject({
        fundingCents: z.number().int(),
        monthPlanTotals: z.array(z.number().int()),
        monthActualTotals: z.array(z.number().int()),
      }),
      scorecards: looseObject({
        totalBudgetCents: z.number().int(),
        spentCents: z.number().int(),
        remainingCents: z.number().int(),
        estimateCents: z.number().int(),
        varianceCents: z.number().int(),
        pctUsed: z.number().int(),
        lineItemCount: z.number().int(),
        phaseCount: z.number().int(),
      }),
    }),
  },
  examples: [
    { title: "Whole-project grid, window derived from data", args: {} },
    { title: "One phase, explicit range", args: { from: "2026-01", to: "2026-06", phaseId: 2 } },
    { title: "Search line-item labels", args: { q: "tile" } },
  ],
  handler: async ({ db }, input) => {
    const grid = await loadBudgetGrid(db, {
      from: input.from ?? null,
      to: input.to ?? null,
      phase: input.phaseId !== undefined ? String(input.phaseId) : null,
      q: input.q ?? null,
    });

    const lineItemCount = grid.phases.reduce((sum, phase) => sum + phase.lines.length, 0);
    const { spentCents, totalBudgetCents, pctUsed, varianceCents } = grid.scorecards;
    const varianceSign = varianceCents >= 0 ? "+" : "-";
    const summary =
      `${grid.phases.length} phase${grid.phases.length === 1 ? "" : "s"}, ` +
      `${lineItemCount} line item${lineItemCount === 1 ? "" : "s"}, ` +
      `spent ${formatCents(spentCents)} of ${formatCents(totalBudgetCents)} (${pctUsed}% used), ` +
      `variance ${varianceSign}${formatCents(Math.abs(varianceCents))}`;

    return { summary, grid };
  },
});
