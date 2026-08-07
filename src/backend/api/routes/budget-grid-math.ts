/**
 * @fileoverview Pure aggregation math for the 0035 time-phased budget grid.
 *
 * Deliberately side-effect-free (no D1, no Date.now()) so it can be unit
 * tested and reasoned about independently of the Hono route in
 * `budget-grid.ts`. Mirrors the reference `support.js` math in the task
 * brief exactly — see `.superpowers/sdd/IMPLEMENTATION_PLAN/task-1-brief.md`.
 */

export type GridMonth = { period: string; label: string };

export type GridFlag = {
  type: "destructive" | "warning" | "success";
  pct: number;
  note: string | null;
} | null;

export type GridLine = {
  id: number;
  trackId: string;
  label: string;
  plan: number[];
  actual: number[];
  flag: GridFlag;
};

export type GridPhase = {
  id: number;
  name: string;
  tone: string | null;
  progressPct: number;
  plan: number[];
  actual: number[];
  lines: GridLine[];
};

export type GridScorecards = {
  totalBudgetCents: number;
  spentCents: number;
  remainingCents: number;
  estimateCents: number;
  varianceCents: number;
  pctUsed: number;
  lineItemCount: number;
  phaseCount: number;
};

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const PERIOD_RE = /^(\d{4})-(\d{2})$/;

/** Parse a 'YYYY-MM' period into { year, month0 } (month0 is 0-indexed). Throws on bad input. */
function parsePeriod(period: string): { year: number; month0: number } {
  const match = PERIOD_RE.exec(period);
  if (!match) throw new Error(`Invalid period "${period}", expected YYYY-MM`);
  return { year: Number(match[1]), month0: Number(match[2]) - 1 };
}

/** Format a 'YYYY-MM' period into a display label, e.g. "Feb 2026". Pure, no Date object. */
export function formatMonthLabel(period: string): string {
  const { year, month0 } = parsePeriod(period);
  return `${MONTH_ABBR[((month0 % 12) + 12) % 12]} ${year}`;
}

/** Add `delta` calendar months to a 'YYYY-MM' period (delta may be negative). Pure. */
export function addMonths(period: string, delta: number): string {
  const { year, month0 } = parsePeriod(period);
  const total = year * 12 + month0 + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth0 = ((total % 12) + 12) % 12;
  return `${nextYear}-${String(nextMonth0 + 1).padStart(2, "0")}`;
}

/** Convert a unix epoch SECONDS timestamp to its 'YYYY-MM' month bucket (UTC). Pure. */
export function secondsToMonth(seconds: number): string {
  const date = new Date(seconds * 1000);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Derive the month window from every period actually present in the data
 * (plan-schedule periods + expense months), capped to at most 12 months
 * ending at the latest one seen. Empty input -> empty window (no
 * Date.now() fallback here — see budget-grid.ts for why an empty grid is
 * an acceptable result when there is truly no data yet).
 */
export function deriveMonthWindow(periodsPresent: string[], capMonths = 12): string[] {
  const unique = Array.from(new Set(periodsPresent)).sort();
  if (unique.length === 0) return [];
  const latest = unique[unique.length - 1];
  const earliest = unique[0];
  const earliestCapped = addMonths(latest, -(capMonths - 1));
  const start = earliestCapped > earliest ? earliestCapped : earliest;
  const months: string[] = [];
  let cursor = start;
  while (cursor <= latest) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  // Guard against the 12-month cap still overshooting (shouldn't happen, but
  // keep the contract airtight rather than trust the loop above blindly).
  return months.length > capMonths ? months.slice(months.length - capMonths) : months;
}

type LineInput = {
  id: number;
  trackId: string;
  label: string;
  phaseId: number | null;
  varianceNoteMarkdown: string | null;
};

type PlanRowInput = { budgetItemTrackId: string; period: string; plannedCents: number };
type ExpenseRowInput = {
  budgetItemTrackId: string | null;
  amountCents: number;
  dateIncurred: number | null;
};

type PhaseDefInput = { id: number; name: string; tone: string | null; sortOrder: number };

export type ComputeGridMathInput = {
  months: string[];
  items: LineInput[];
  phaseDefs: PhaseDefInput[];
  planRows: PlanRowInput[];
  expenseRows: ExpenseRowInput[];
  phaseFilter: string | null; // 'all' or numeric phase id as string, or null
  q: string | null;
};

const UNPHASED_PHASE: PhaseDefInput = {
  id: 0,
  name: "Unphased",
  tone: null,
  sortOrder: Number.MAX_SAFE_INTEGER,
};

function zeros(n: number): number[] {
  return Array.from({ length: n }, () => 0);
}

function sumArray(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function toneForPhase(defTone: string | null, planTotal: number, actualTotal: number): string {
  if (defTone) return defTone;
  const over = actualTotal - planTotal;
  if (over <= 0) return "emerald";
  if (over <= 0.1 * planTotal) return "amber";
  return "danger";
}

function flagForLine(planSum: number, actualSum: number, note: string | null): GridFlag {
  const hasNote = Boolean(note && note.trim().length > 0);
  let variancePct: number | null = null;
  if (planSum > 0) {
    variancePct = (planSum - actualSum) / planSum;
  }
  const meetsThreshold = variancePct !== null && Math.abs(variancePct) >= 0.05;
  if (!meetsThreshold && !hasNote) return null;

  let type: "destructive" | "warning" | "success";
  if (variancePct !== null && variancePct <= -0.1) {
    type = "destructive";
  } else if (variancePct !== null && variancePct < 0) {
    type = "warning";
  } else if (variancePct !== null && variancePct > 0) {
    type = "success";
  } else {
    // No plan baseline (planSum <= 0) or exactly on budget, but a note was
    // authored — surface it without implying an over/under verdict we can't
    // compute. ponytail: default to "warning" (needs-a-look), not a hard call.
    type = "warning";
  }
  return {
    type,
    pct: variancePct !== null ? Math.round(variancePct * 100) : 0,
    note: note ?? null,
  };
}

/**
 * Core aggregation: buckets plan/actual by month per line, rolls lines up
 * into phases (incl. the synthetic "Unphased" group, sorted last), and
 * applies the `phase`/`q` filters. Scorecards are NOT computed here — they
 * are whole-project and independent of filters/window (see budget-grid.ts).
 */
export function computeGridMath(input: ComputeGridMathInput): {
  months: GridMonth[];
  phases: GridPhase[];
} {
  const { months, items, phaseDefs, planRows, expenseRows, phaseFilter, q } = input;
  const monthIndex = new Map(months.map((period, i) => [period, i]));

  const planByTrack = new Map<string, number[]>();
  for (const row of planRows) {
    const idx = monthIndex.get(row.period);
    if (idx === undefined) continue;
    const arr = planByTrack.get(row.budgetItemTrackId) ?? zeros(months.length);
    arr[idx] += row.plannedCents;
    planByTrack.set(row.budgetItemTrackId, arr);
  }

  const actualByTrack = new Map<string, number[]>();
  for (const row of expenseRows) {
    if (!row.budgetItemTrackId || row.dateIncurred === null) continue;
    const period = secondsToMonth(row.dateIncurred);
    const idx = monthIndex.get(period);
    if (idx === undefined) continue;
    const arr = actualByTrack.get(row.budgetItemTrackId) ?? zeros(months.length);
    arr[idx] += row.amountCents;
    actualByTrack.set(row.budgetItemTrackId, arr);
  }

  const phaseDefsWithUnphased = [...phaseDefs, UNPHASED_PHASE].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const linesByPhaseId = new Map<number, GridLine[]>();

  const qNormalized = q && q.trim().length > 0 ? q.trim().toLowerCase() : null;

  for (const item of items) {
    const plan = planByTrack.get(item.trackId) ?? zeros(months.length);
    const actual = actualByTrack.get(item.trackId) ?? zeros(months.length);
    if (qNormalized && !item.label.toLowerCase().includes(qNormalized)) continue;

    const phaseId = item.phaseId ?? 0;
    const flag = flagForLine(sumArray(plan), sumArray(actual), item.varianceNoteMarkdown);
    const line: GridLine = {
      id: item.id,
      trackId: item.trackId,
      label: item.label,
      plan,
      actual,
      flag,
    };
    const bucket = linesByPhaseId.get(phaseId) ?? [];
    bucket.push(line);
    linesByPhaseId.set(phaseId, bucket);
  }

  const phaseFilterId =
    phaseFilter && phaseFilter !== "all" && /^-?\d+$/.test(phaseFilter)
      ? Number(phaseFilter)
      : null;

  const phases: GridPhase[] = [];
  for (const def of phaseDefsWithUnphased) {
    if (phaseFilterId !== null && def.id !== phaseFilterId) continue;
    const lines = linesByPhaseId.get(def.id) ?? [];
    if (qNormalized && lines.length === 0) continue; // drop empty phase only while q is active
    const plan = zeros(months.length);
    const actual = zeros(months.length);
    for (const line of lines) {
      for (let i = 0; i < months.length; i += 1) {
        plan[i] += line.plan[i];
        actual[i] += line.actual[i];
      }
    }
    const planTotal = sumArray(plan);
    const actualTotal = sumArray(actual);
    const progressPct =
      planTotal > 0 ? Math.min(100, Math.max(0, Math.round((100 * actualTotal) / planTotal))) : 0;
    phases.push({
      id: def.id,
      name: def.name,
      tone: toneForPhase(def.tone, planTotal, actualTotal),
      progressPct,
      plan,
      actual,
      lines,
    });
  }

  return {
    months: months.map((period) => ({ period, label: formatMonthLabel(period) })),
    phases,
  };
}

// No self-check lives in this file on purpose: this module is imported by
// `budget-grid.ts`, which is reachable from the Worker's entry point, so
// anything exported here is bundled into the deployed Worker (this repo has
// hit Cloudflare's 10 MiB Worker script-size cap once already — see
// worker-10mb-liteparse-blocker in project memory). The self-check + its
// fixtures live in `scripts/tests/test_budget_grid_math.mjs` instead, which
// is a standalone Node script that dynamically imports the pure functions
// below and is never part of the Worker bundle. Run it with:
//   npx tsx scripts/tests/test_budget_grid_math.mjs
