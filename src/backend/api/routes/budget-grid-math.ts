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

// --- Self-check -------------------------------------------------------
// Deterministic, assert-based, no framework. Run with:
//   npx tsx src/backend/api/routes/budget-grid-math.ts
export function __selfCheck(): void {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) throw new Error(`[budget-grid-math self-check] FAILED: ${msg}`);
  };

  // secondsToMonth: 2026-02-15T00:00:00Z
  assert(secondsToMonth(1771113600) === "2026-02", "secondsToMonth bucket");

  // addMonths / formatMonthLabel
  assert(addMonths("2026-01", 1) === "2026-02", "addMonths forward within year");
  assert(addMonths("2026-01", -1) === "2025-12", "addMonths backward across year");
  assert(addMonths("2025-12", 2) === "2026-02", "addMonths forward across year");
  assert(formatMonthLabel("2026-02") === "Feb 2026", "formatMonthLabel");

  // deriveMonthWindow: caps at 12, ends at latest
  const many = ["2024-01", "2024-06", "2025-01", "2026-02"];
  const windowed = deriveMonthWindow(many, 12);
  assert(windowed[windowed.length - 1] === "2026-02", "deriveMonthWindow ends at latest");
  assert(windowed.length === 12, "deriveMonthWindow caps at 12");
  assert(windowed[0] === "2025-03", "deriveMonthWindow starts 12 back from latest");
  assert(deriveMonthWindow([]).length === 0, "deriveMonthWindow empty input -> empty window");
  const short = deriveMonthWindow(["2026-01", "2026-03"]);
  assert(short.join(",") === "2026-01,2026-02,2026-03", "deriveMonthWindow fills gaps");

  // computeGridMath: plan/actual bucket into right months, phase totals sum
  const months = ["2026-01", "2026-02", "2026-03"];
  const items: LineInput[] = [
    { id: 1, trackId: "t1", label: "Demo kitchen", phaseId: 10, varianceNoteMarkdown: null },
    {
      id: 2,
      trackId: "t2",
      label: "Drain repair",
      phaseId: 10,
      varianceNoteMarkdown: "over due to permit delay",
    },
    { id: 3, trackId: "t3", label: "Landscape reserve", phaseId: null, varianceNoteMarkdown: null },
  ];
  const phaseDefs: PhaseDefInput[] = [
    { id: 10, name: "Pre-construction", tone: null, sortOrder: 0 },
  ];
  const planRows: PlanRowInput[] = [
    { budgetItemTrackId: "t1", period: "2026-01", plannedCents: 100000 },
    { budgetItemTrackId: "t1", period: "2026-02", plannedCents: 100000 },
    { budgetItemTrackId: "t2", period: "2026-01", plannedCents: 50000 },
    { budgetItemTrackId: "t3", period: "2026-03", plannedCents: 20000 },
  ];
  const expenseRows: ExpenseRowInput[] = [
    // t1: month 0, on plan -> actual 100000 matches plan 100000 for jan (variance across window computed on totals)
    { budgetItemTrackId: "t1", amountCents: 100000, dateIncurred: 1767225600 }, // 2026-01-01
    { budgetItemTrackId: "t2", amountCents: 60000, dateIncurred: 1767225600 }, // over the 50000 plan
  ];

  const result = computeGridMath({
    months,
    items,
    phaseDefs,
    planRows,
    expenseRows,
    phaseFilter: null,
    q: null,
  });
  assert(result.months.length === 3, "computeGridMath months length");
  assert(result.phases.length === 2, "computeGridMath: pre-construction + Unphased");

  const preConstruction = result.phases.find((p) => p.id === 10);
  assert(!!preConstruction, "pre-construction phase present");
  // plan[0] (jan) = t1 100000 + t2 50000 = 150000; actual[0] = t1 100000 + t2 60000 = 160000
  assert(preConstruction!.plan[0] === 150000, "phase plan[0] sums lines");
  assert(preConstruction!.actual[0] === 160000, "phase actual[0] sums lines");
  // plan[1] (feb) = t1 100000; actual[1] = 0
  assert(preConstruction!.plan[1] === 100000, "phase plan[1] sums lines");
  assert(preConstruction!.actual[1] === 0, "phase actual[1] sums lines");

  const t1Line = preConstruction!.lines.find((l) => l.trackId === "t1")!;
  // t1: planSum=200000, actualSum=100000 -> variancePct = (200000-100000)/200000 = 0.5 -> under -> success
  assert(t1Line.flag !== null, "t1 flag emitted (50% under threshold)");
  assert(t1Line.flag!.type === "success", "t1 flag type success (under budget)");
  assert(t1Line.flag!.pct === 50, "t1 flag pct = 50");

  const t2Line = preConstruction!.lines.find((l) => l.trackId === "t2")!;
  // t2: planSum=50000, actualSum=60000 -> variancePct = (50000-60000)/50000 = -0.2 -> over by >10% -> destructive
  assert(t2Line.flag !== null, "t2 flag emitted (has note + over threshold)");
  assert(t2Line.flag!.type === "destructive", "t2 flag type destructive (over by >10%)");
  assert(t2Line.flag!.pct === -20, "t2 flag pct = -20");
  assert(t2Line.flag!.note === "over due to permit delay", "t2 flag carries the variance note");

  const unphased = result.phases.find((p) => p.id === 0)!;
  assert(unphased.name === "Unphased", "unphased synthetic phase name");
  assert(unphased.lines.length === 1 && unphased.lines[0].trackId === "t3", "unphased groups t3");
  assert(result.phases[result.phases.length - 1].id === 0, "unphased sorts last");

  // progressPct clamp + zero-plan-total -> 0
  assert(unphased.plan[2] === 20000, "unphased plan[2] (march) = 20000");
  assert(unphased.actual[2] === 0, "unphased actual has no expense -> 0");
  assert(unphased.progressPct === 0, "unphased progressPct: 0 actual / 20000 plan = 0");

  // phase filter: keep only phase 10
  const filteredByPhase = computeGridMath({
    months,
    items,
    phaseDefs,
    planRows,
    expenseRows,
    phaseFilter: "10",
    q: null,
  });
  assert(
    filteredByPhase.phases.length === 1 && filteredByPhase.phases[0].id === 10,
    "phase filter keeps only id=10",
  );

  // q filter: only "drain" -> keeps t2, drops phase 0 (t3) entirely, and t1 from phase 10
  const filteredByQ = computeGridMath({
    months,
    items,
    phaseDefs,
    planRows,
    expenseRows,
    phaseFilter: null,
    q: "drain",
  });
  assert(filteredByQ.phases.length === 1, "q filter drops the now-empty Unphased phase");
  assert(
    filteredByQ.phases[0].lines.length === 1 && filteredByQ.phases[0].lines[0].trackId === "t2",
    "q filter keeps t2 only",
  );

  // tone derivation: no def tone, over > 10% of plan -> danger
  const dangerPhaseDefs: PhaseDefInput[] = [
    { id: 20, name: "Danger phase", tone: null, sortOrder: 0 },
  ];
  const dangerItems: LineInput[] = [
    { id: 9, trackId: "t9", label: "x", phaseId: 20, varianceNoteMarkdown: null },
  ];
  const dangerPlan: PlanRowInput[] = [
    { budgetItemTrackId: "t9", period: "2026-01", plannedCents: 100000 },
  ];
  const dangerExpense: ExpenseRowInput[] = [
    { budgetItemTrackId: "t9", amountCents: 130000, dateIncurred: 1767225600 }, // 30% over
  ];
  const dangerResult = computeGridMath({
    months: ["2026-01"],
    items: dangerItems,
    phaseDefs: dangerPhaseDefs,
    planRows: dangerPlan,
    expenseRows: dangerExpense,
    phaseFilter: null,
    q: null,
  });
  const dangerPhase = dangerResult.phases.find((p) => p.id === 20)!;
  assert(dangerPhase.tone === "danger", "tone: over by >10% of plan -> danger");

  const amberExpense: ExpenseRowInput[] = [
    { budgetItemTrackId: "t9", amountCents: 105000, dateIncurred: 1767225600 }, // 5% over
  ];
  const amberResult = computeGridMath({
    months: ["2026-01"],
    items: dangerItems,
    phaseDefs: dangerPhaseDefs,
    planRows: dangerPlan,
    expenseRows: amberExpense,
    phaseFilter: null,
    q: null,
  });
  assert(
    amberResult.phases.find((p) => p.id === 20)!.tone === "amber",
    "tone: over <=10% of plan -> amber",
  );

  const emeraldExpense: ExpenseRowInput[] = [
    { budgetItemTrackId: "t9", amountCents: 90000, dateIncurred: 1767225600 },
  ];
  const emeraldResult = computeGridMath({
    months: ["2026-01"],
    items: dangerItems,
    phaseDefs: dangerPhaseDefs,
    planRows: dangerPlan,
    expenseRows: emeraldExpense,
    phaseFilter: null,
    q: null,
  });
  assert(
    emeraldResult.phases.find((p) => p.id === 20)!.tone === "emerald",
    "tone: under/at plan -> emerald",
  );

  // pctUsed-style math (used identically in scorecards) — spot check the formula directly.
  const pctUsed = (spent: number, total: number) =>
    total > 0 ? Math.round((100 * spent) / total) : 0;
  assert(pctUsed(50000, 200000) === 25, "pctUsed formula");
  assert(pctUsed(1, 0) === 0, "pctUsed formula: zero total -> 0");

  console.log("[budget-grid-math self-check] all assertions passed");
}

// Allow `npx tsx src/backend/api/routes/budget-grid-math.ts` to run the self-check directly.
if (typeof require !== "undefined" && require.main === module) {
  __selfCheck();
}
