// Run: npx tsx scripts/tests/test_budget_grid_math.mjs
//
// Deterministic, assert-based check of the pure budget-grid aggregation math
// (0035 time-phased budget grid). Deliberately NOT inside
// src/backend/api/routes/budget-grid-math.ts — that module is imported by
// budget-grid.ts, which is reachable from the Worker's entry point, so
// anything exported there ships in the deployed Worker bundle. This script
// lives outside src/backend entirely and dynamically imports the pure
// functions under Node's native TS stripping (same pattern as
// scripts/tests/test_brand_reconcile.mjs), so the fixtures below never touch
// the Worker bundle.
import assert from "node:assert";

const { addMonths, formatMonthLabel, secondsToMonth, deriveMonthWindow, computeGridMath } =
  await import("../../src/backend/api/routes/budget-grid-math.ts");

// secondsToMonth: 2026-02-15T00:00:00Z
assert.strictEqual(secondsToMonth(1771113600), "2026-02", "secondsToMonth bucket");

// addMonths / formatMonthLabel
assert.strictEqual(addMonths("2026-01", 1), "2026-02", "addMonths forward within year");
assert.strictEqual(addMonths("2026-01", -1), "2025-12", "addMonths backward across year");
assert.strictEqual(addMonths("2025-12", 2), "2026-02", "addMonths forward across year");
assert.strictEqual(formatMonthLabel("2026-02"), "Feb 2026", "formatMonthLabel");

// deriveMonthWindow: caps at 12, ends at latest
const many = ["2024-01", "2024-06", "2025-01", "2026-02"];
const windowed = deriveMonthWindow(many, 12);
assert.strictEqual(windowed[windowed.length - 1], "2026-02", "deriveMonthWindow ends at latest");
assert.strictEqual(windowed.length, 12, "deriveMonthWindow caps at 12");
assert.strictEqual(windowed[0], "2025-03", "deriveMonthWindow starts 12 back from latest");
assert.strictEqual(
  deriveMonthWindow([]).length,
  0,
  "deriveMonthWindow empty input -> empty window",
);
const short = deriveMonthWindow(["2026-01", "2026-03"]);
assert.strictEqual(short.join(","), "2026-01,2026-02,2026-03", "deriveMonthWindow fills gaps");

// computeGridMath: plan/actual bucket into right months, phase totals sum
const months = ["2026-01", "2026-02", "2026-03"];
const items = [
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
const phaseDefs = [{ id: 10, name: "Pre-construction", tone: null, sortOrder: 0 }];
const planRows = [
  { budgetItemTrackId: "t1", period: "2026-01", plannedCents: 100000 },
  { budgetItemTrackId: "t1", period: "2026-02", plannedCents: 100000 },
  { budgetItemTrackId: "t2", period: "2026-01", plannedCents: 50000 },
  { budgetItemTrackId: "t3", period: "2026-03", plannedCents: 20000 },
];
const expenseRows = [
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
assert.strictEqual(result.months.length, 3, "computeGridMath months length");
assert.strictEqual(result.phases.length, 2, "computeGridMath: pre-construction + Unphased");

const preConstruction = result.phases.find((p) => p.id === 10);
assert.ok(preConstruction, "pre-construction phase present");
// plan[0] (jan) = t1 100000 + t2 50000 = 150000; actual[0] = t1 100000 + t2 60000 = 160000
assert.strictEqual(preConstruction.plan[0], 150000, "phase plan[0] sums lines");
assert.strictEqual(preConstruction.actual[0], 160000, "phase actual[0] sums lines");
// plan[1] (feb) = t1 100000; actual[1] = 0
assert.strictEqual(preConstruction.plan[1], 100000, "phase plan[1] sums lines");
assert.strictEqual(preConstruction.actual[1], 0, "phase actual[1] sums lines");

const t1Line = preConstruction.lines.find((l) => l.trackId === "t1");
// t1: planSum=200000, actualSum=100000 -> variancePct = (200000-100000)/200000 = 0.5 -> under -> success
assert.notStrictEqual(t1Line.flag, null, "t1 flag emitted (50% under threshold)");
assert.strictEqual(t1Line.flag.type, "success", "t1 flag type success (under budget)");
assert.strictEqual(t1Line.flag.pct, 50, "t1 flag pct = 50");

const t2Line = preConstruction.lines.find((l) => l.trackId === "t2");
// t2: planSum=50000, actualSum=60000 -> variancePct = (50000-60000)/50000 = -0.2 -> over by >10% -> destructive
assert.notStrictEqual(t2Line.flag, null, "t2 flag emitted (has note + over threshold)");
assert.strictEqual(t2Line.flag.type, "destructive", "t2 flag type destructive (over by >10%)");
assert.strictEqual(t2Line.flag.pct, -20, "t2 flag pct = -20");
assert.strictEqual(
  t2Line.flag.note,
  "over due to permit delay",
  "t2 flag carries the variance note",
);

const unphased = result.phases.find((p) => p.id === 0);
assert.strictEqual(unphased.name, "Unphased", "unphased synthetic phase name");
assert.strictEqual(unphased.lines.length, 1, "unphased groups exactly one line");
assert.strictEqual(unphased.lines[0].trackId, "t3", "unphased groups t3");
assert.strictEqual(result.phases[result.phases.length - 1].id, 0, "unphased sorts last");

// progressPct clamp + zero-plan-total -> 0
assert.strictEqual(unphased.plan[2], 20000, "unphased plan[2] (march) = 20000");
assert.strictEqual(unphased.actual[2], 0, "unphased actual has no expense -> 0");
assert.strictEqual(unphased.progressPct, 0, "unphased progressPct: 0 actual / 20000 plan = 0");

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
assert.strictEqual(filteredByPhase.phases.length, 1, "phase filter keeps only one phase");
assert.strictEqual(filteredByPhase.phases[0].id, 10, "phase filter keeps id=10");

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
assert.strictEqual(filteredByQ.phases.length, 1, "q filter drops the now-empty Unphased phase");
assert.strictEqual(filteredByQ.phases[0].lines.length, 1, "q filter keeps exactly one line");
assert.strictEqual(filteredByQ.phases[0].lines[0].trackId, "t2", "q filter keeps t2 only");

// tone derivation: no def tone, over > 10% of plan -> danger
const dangerPhaseDefs = [{ id: 20, name: "Danger phase", tone: null, sortOrder: 0 }];
const dangerItems = [{ id: 9, trackId: "t9", label: "x", phaseId: 20, varianceNoteMarkdown: null }];
const dangerPlan = [{ budgetItemTrackId: "t9", period: "2026-01", plannedCents: 100000 }];

const dangerResult = computeGridMath({
  months: ["2026-01"],
  items: dangerItems,
  phaseDefs: dangerPhaseDefs,
  planRows: dangerPlan,
  expenseRows: [{ budgetItemTrackId: "t9", amountCents: 130000, dateIncurred: 1767225600 }], // 30% over
  phaseFilter: null,
  q: null,
});
assert.strictEqual(
  dangerResult.phases.find((p) => p.id === 20).tone,
  "danger",
  "tone: over by >10% of plan -> danger",
);

const amberResult = computeGridMath({
  months: ["2026-01"],
  items: dangerItems,
  phaseDefs: dangerPhaseDefs,
  planRows: dangerPlan,
  expenseRows: [{ budgetItemTrackId: "t9", amountCents: 105000, dateIncurred: 1767225600 }], // 5% over
  phaseFilter: null,
  q: null,
});
assert.strictEqual(
  amberResult.phases.find((p) => p.id === 20).tone,
  "amber",
  "tone: over <=10% of plan -> amber",
);

const emeraldResult = computeGridMath({
  months: ["2026-01"],
  items: dangerItems,
  phaseDefs: dangerPhaseDefs,
  planRows: dangerPlan,
  expenseRows: [{ budgetItemTrackId: "t9", amountCents: 90000, dateIncurred: 1767225600 }],
  phaseFilter: null,
  q: null,
});
assert.strictEqual(
  emeraldResult.phases.find((p) => p.id === 20).tone,
  "emerald",
  "tone: under/at plan -> emerald",
);

// pctUsed-style math (used identically in the route's scorecards) — spot check the formula directly.
const pctUsed = (spent, total) => (total > 0 ? Math.round((100 * spent) / total) : 0);
assert.strictEqual(pctUsed(50000, 200000), 25, "pctUsed formula");
assert.strictEqual(pctUsed(1, 0), 0, "pctUsed formula: zero total -> 0");

console.log("[test_budget_grid_math] all assertions passed");
