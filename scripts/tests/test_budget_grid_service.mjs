// Run: npx tsx scripts/tests/test_budget_grid_service.mjs
//
// Deterministic, assert-based check of the pure window-filling helper moved
// (from budget-grid.ts's private inline copy) into
// src/backend/services/budget/grid.ts when the GET /api/budget/grid
// aggregation was extracted into `loadBudgetGrid()` for reuse by the
// `get_budget_grid` MCP tool (0035 task 2). `loadBudgetGrid` itself needs a
// live D1 binding (it reads budget_tracker_items/budget_plan_schedule/etc),
// so it isn't exercised here — this covers the one exported pure piece.
import assert from "node:assert";

const { fillMonthRange } = await import("../../src/backend/services/budget/grid.ts");

assert.strictEqual(
  fillMonthRange("2026-01", "2026-03").join(","),
  "2026-01,2026-02,2026-03",
  "fillMonthRange fills within a year",
);
assert.strictEqual(
  fillMonthRange("2025-11", "2026-02").join(","),
  "2025-11,2025-12,2026-01,2026-02",
  "fillMonthRange crosses a year boundary",
);
assert.strictEqual(
  fillMonthRange("2026-03", "2026-01").join(","),
  "2026-01,2026-02,2026-03",
  "fillMonthRange normalizes a reversed pair",
);
assert.strictEqual(
  fillMonthRange("2026-01", "2026-01").join(","),
  "2026-01",
  "fillMonthRange single month",
);
assert.strictEqual(fillMonthRange("bogus", "2026-01").length, 0, "fillMonthRange rejects bad from");
assert.strictEqual(fillMonthRange("2026-01", "bogus").length, 0, "fillMonthRange rejects bad to");
// No cap — an explicit multi-year range is never truncated (that's the
// derived-from-data path's job, not this helper's).
assert.strictEqual(
  fillMonthRange("2020-01", "2026-01").length,
  73,
  "fillMonthRange has no built-in cap",
);

console.log("[test_budget_grid_service] all assertions passed");
