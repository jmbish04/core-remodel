// Run: npx tsx scripts/tests/test_budget_grid_pivot.mjs
//
// Deterministic, assert-based check of the Budget Command Center grid pivot
// (API-CONTRACT.md §2 shape: months[].key, phases[].rows[].cells). Lives
// outside src/backend so nothing test-only ships in the Worker bundle — same
// pattern as scripts/tests/test_budget_grid_math.mjs for the 0035 grid math
// this section sits alongside.
import assert from "node:assert";

const { monthsBetween, monthStartEpochSeconds, pivotBudgetGrid } = await import(
  "../../src/backend/api/routes/budget-grid-math.ts"
);

// monthsBetween: inclusive range, crosses a year boundary
assert.deepStrictEqual(monthsBetween("2025-12", "2026-02"), [
  "2025-12",
  "2026-01",
  "2026-02",
]);
assert.deepStrictEqual(monthsBetween("2026-01", "2026-01"), ["2026-01"]);

// monthStartEpochSeconds: 2026-02-01T00:00:00Z
assert.strictEqual(monthStartEpochSeconds("2026-02"), 1769904000);

// pivotBudgetGrid: two lines, two phases, one unphased line, plan + actual
// land in the right cells, totals/variance/subtotals compute correctly.
const months = ["2026-01", "2026-02", "2026-03"];
const items = [
  {
    id: 1,
    trackId: "t1",
    title: "Tile & stone",
    phaseId: 10,
    note: "slab upgrade",
    vendorId: null,
    vendorLabel: null,
  },
  {
    id: 2,
    trackId: "t2",
    title: "Cabinetry",
    phaseId: 10,
    note: null,
    vendorId: null,
    vendorLabel: null,
  },
  {
    id: 3,
    trackId: "t3",
    title: "Landscape reserve",
    phaseId: null, // -> Unphased (0)
    note: null,
    vendorId: null,
    vendorLabel: null,
  },
];
const phaseDefs = [{ id: 10, name: "Finishes", sortOrder: 0 }];
const planRows = [
  { trackId: "t1", period: "2026-02", plannedCents: 11600 },
  { trackId: "t2", period: "2026-02", plannedCents: 14500 },
  { trackId: "t2", period: "2026-03", plannedCents: 6000 },
  { trackId: "t3", period: "2026-03", plannedCents: 2000 },
];
const actualRows = [{ trackId: "t1", period: "2026-01", actualCents: 4200 }];

const result = pivotBudgetGrid(months, items, phaseDefs, planRows, actualRows);

assert.deepStrictEqual(
  result.months.map((m) => m.key),
  months,
  "month keys preserve order",
);
assert.strictEqual(result.months[0].label, "Jan 2026", "month label formatted");

assert.strictEqual(result.phases.length, 2, "Finishes + Unphased, no empty phases");
const finishes = result.phases.find((p) => p.phaseId === 10);
assert.ok(finishes, "Finishes phase present");
assert.strictEqual(finishes.rows.length, 2);

const tile = finishes.rows.find((r) => r.trackId === "t1");
assert.strictEqual(tile.cells["2026-01"].actualCents, 4200);
assert.strictEqual(tile.cells["2026-01"].plannedCents, null);
assert.strictEqual(tile.cells["2026-01"].isEditable, false, "actual posted -> not editable");
assert.strictEqual(tile.cells["2026-02"].plannedCents, 11600);
assert.strictEqual(tile.cells["2026-02"].isEditable, true, "plan-only cell -> editable");
assert.strictEqual(tile.cells["2026-03"].plannedCents, null);
assert.strictEqual(tile.cells["2026-03"].actualCents, null);
assert.strictEqual(tile.cells["2026-03"].isEditable, true, "empty cell -> editable");
assert.strictEqual(tile.totalCents, 11600, "totalCents = sum of planned across the window");
assert.strictEqual(tile.varianceCents, 4200 - 11600, "varianceCents = actual - planned; positive = over budget");
assert.strictEqual(tile.note, "slab upgrade");

const cabinetry = finishes.rows.find((r) => r.trackId === "t2");
assert.strictEqual(cabinetry.totalCents, 20500);
assert.strictEqual(cabinetry.varianceCents, -20500, "nothing spent -> fully UNDER by the planned amount");

assert.strictEqual(finishes.subtotalCents, tile.totalCents + cabinetry.totalCents);

const unphased = result.phases.find((p) => p.phaseId === 0);
assert.ok(unphased, "Unphased phase present (has t3)");
assert.strictEqual(unphased.name, "Unphased");
assert.strictEqual(unphased.rows[0].trackId, "t3");
assert.strictEqual(unphased.subtotalCents, 2000);

// A phase def with zero assigned items in the window is dropped, not emitted empty.
const withEmptyPhase = pivotBudgetGrid(
  months,
  items.filter((i) => i.trackId !== "t3"),
  [...phaseDefs, { id: 99, name: "Exterior", sortOrder: 1 }],
  planRows,
  actualRows,
);
assert.ok(
  !withEmptyPhase.phases.some((p) => p.phaseId === 99),
  "phase with no line items in the window is omitted",
);

console.log("test_budget_grid_pivot.mjs: all assertions passed");
