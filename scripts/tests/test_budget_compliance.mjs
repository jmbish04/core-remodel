// Run: npx tsx scripts/tests/test_budget_compliance.mjs
//
// Deterministic, assert-based check of the CSLB down-payment-cap math
// (Budget Command Center compliance surface). Deliberately NOT inside
// src/backend/api/routes/budget-compliance.ts — that module is the route
// itself, reachable from the Worker's entry point, so anything exported
// there ships in the deployed Worker bundle (same reasoning as
// test_budget_grid_math.mjs). This script lives outside src/backend
// entirely and dynamically imports the pure functions under Node's native
// TS stripping, so the fixtures below never touch the Worker bundle.
import assert from "node:assert";

// capForContractCents is SHARED math (src/backend/services/budget/
// compliance-gates.ts) — budget-workbench.ts's header badge/decision inbox
// counts against the same function, so it's imported from there rather than
// re-tested as a local copy. downPaymentGate (evidence-text formatting) stays
// local to the route and is imported from there.
const { capForContractCents } = await import(
  "../../src/backend/services/budget/compliance-gates.ts"
);
const { downPaymentGate } = await import("../../src/backend/api/routes/budget-compliance.ts");

// $118,400 contract → 10% = $11,840, cap = lesser of $1,000 or $11,840 = $1,000.
assert.strictEqual(capForContractCents(118_400_00), 100_000, "large contract caps at $1,000");
// $9,500 contract → 10% = $950, which is under $1,000, so cap = $950.
assert.strictEqual(capForContractCents(9_500_00), 95_000, "small contract caps at 10%");
// Exact boundary: $10,000 contract → 10% = $1,000 = the flat cap either way.
assert.strictEqual(capForContractCents(10_000_00), 100_000, "boundary contract caps at $1,000");
// Non-round cents: floor(9_995_00 / 10) = 99_950 — never a float multiply artifact.
assert.strictEqual(capForContractCents(9_995_00), 99_950, "10% floors exactly, no float drift");

assert.strictEqual(
  downPaymentGate(118_400_00, 400_000).state,
  "fail",
  "$4,000 down payment on a $118,400 contract must fail (cap is $1,000)",
);
assert.strictEqual(
  downPaymentGate(31_600_00, 95_000).state,
  "pass",
  "$950 down payment on a $31,600 contract must pass (cap is $1,000)",
);
assert.strictEqual(
  downPaymentGate(null, 100_000).state,
  "na",
  "no contract value on file must be na, never pass",
);
assert.strictEqual(
  downPaymentGate(118_400_00, null).state,
  "na",
  "no recorded down payment must be na, never pass",
);

// na evidence must say which value is actually missing, not always
// "no down payment" — see D1-DRIZZLE-RULES-review finding #6.
assert.match(
  downPaymentGate(null, 100_000).evidence.markdown,
  /contract price/i,
  "missing contract price is reported as such, not as a missing down payment",
);
assert.match(
  downPaymentGate(118_400_00, null).evidence.markdown,
  /down payment/i,
  "missing down payment is reported as such",
);
assert.match(
  downPaymentGate(null, null).evidence.markdown,
  /contract price.*down payment|down payment.*contract price/i,
  "both missing is reported as both missing",
);

console.log("[test_budget_compliance] all assertions passed");
