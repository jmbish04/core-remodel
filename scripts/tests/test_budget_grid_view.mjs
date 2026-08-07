// Run: npx tsx scripts/tests/test_budget_grid_view.mjs
//
// Deterministic, assert-based check of the pure CLIENT-SIDE view math for the
// 0035 budget grid (Estimate/Actuals/Variance cell formatting + footer
// rollups). Lives outside the frontend island bundle and dynamically imports
// the pure functions under Node's native TS stripping — same pattern as
// scripts/tests/test_budget_grid_math.mjs.
import assert from "node:assert";

const {
  formatUsd,
  formatSignedUsd,
  cellValue,
  formatCell,
  availableBudget,
  netBurn,
  cumulativeVariance,
  monthlyVariance,
} = await import("../../src/frontend/components/budget-grid-view.ts");

// --- formatting -----------------------------------------------------------
assert.strictEqual(formatUsd(123400), "$1,234", "formatUsd rounds to whole dollars, commas");
assert.strictEqual(formatUsd(0), "$0", "formatUsd zero");
assert.strictEqual(formatUsd(-500099), "$5,001", "formatUsd abs + rounds .99 up");
assert.strictEqual(formatSignedUsd(123400), "+$1,234", "signed positive");
assert.strictEqual(formatSignedUsd(-123400), "-$1,234", "signed negative");
assert.strictEqual(formatSignedUsd(0), "$0", "signed zero");

// --- cellValue per view ---------------------------------------------------
assert.strictEqual(cellValue("estimate", 1000, 700), 1000, "estimate = plan");
assert.strictEqual(cellValue("actuals", 1000, 700), 700, "actuals = actual");
assert.strictEqual(cellValue("variance", 1000, 700), 300, "variance = plan - actual (favorable +)");
assert.strictEqual(cellValue("variance", 700, 1000), -300, "variance over budget is negative");

// --- formatCell -----------------------------------------------------------
assert.deepStrictEqual(
  formatCell("estimate", 123400, 0),
  { text: "$1,234", tone: "plain" },
  "estimate cell",
);
assert.deepStrictEqual(
  formatCell("estimate", 0, 0),
  { text: "$0", tone: "zero" },
  "estimate zero is faint",
);
assert.deepStrictEqual(
  formatCell("actuals", 0, 55000),
  { text: "$550", tone: "plain" },
  "actuals cell",
);
assert.deepStrictEqual(
  formatCell("variance", 100000, 60000),
  { text: "+$400", tone: "pos" },
  "variance favorable = +$ emerald",
);
assert.deepStrictEqual(
  formatCell("variance", 60000, 100000),
  { text: "($400)", tone: "neg" },
  "variance over budget = ($) danger",
);
assert.deepStrictEqual(
  formatCell("variance", 50000, 50000),
  { text: "—", tone: "zero" },
  "variance flat = em dash",
);

// --- footer rollups -------------------------------------------------------
// funding $10,000; actual burn per month: $1k, $2k, $0, $3k
const funding = 1000000;
const actualTotals = [100000, 200000, 0, 300000];
const planTotals = [150000, 150000, 100000, 100000];

assert.deepStrictEqual(
  availableBudget(funding, actualTotals),
  [900000, 700000, 700000, 400000],
  "available = funding - cumulative actual burn",
);
assert.deepStrictEqual(
  netBurn(actualTotals),
  [-100000, -200000, -0, -300000],
  "net burn = -(month actual total)",
);
assert.deepStrictEqual(
  cumulativeVariance(planTotals, actualTotals),
  [50000, 0, 100000, -100000],
  "cumulative variance = running Σ(plan - actual)",
);
assert.deepStrictEqual(
  monthlyVariance(planTotals, actualTotals),
  [50000, -50000, 100000, -200000],
  "monthly variance = plan - actual per month",
);

console.log("[test_budget_grid_view] all assertions passed");
