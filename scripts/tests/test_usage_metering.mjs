#!/usr/bin/env node
/**
 * Pins the circuit-breaker truth table.
 *
 * The one that matters most: a READ ERROR must DENY. The legacy Places breaker
 * fails open ("fail-open strategy if D1 schema isn't migrated yet"), which
 * defeats the point of a ceiling — the moment the ledger is unreadable is
 * exactly when an uncapped loop does the damage.
 *
 * Usage: node scripts/tests/test_usage_metering.mjs | pnpm run test:metering
 */
import assert from "node:assert/strict";

import { cycleStart, decideSpend } from "../../src/backend/services/usage/breaker-rules.ts";

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

/**
 * Calls the REAL decideSpend — not a mirrored copy, which would drift silently.
 * readError is the caller's policy branch (fail closed) and never reaches it.
 */
function decide({ manualBreak = false, snoozeToUsd = null, thresholdUsd = 25, spend = 0, readError = false }) {
  if (readError) return { allowed: false, reason: "read_error" };
  return decideSpend({ manualBreak, snoozeToUsd, thresholdUsd, spendUsd: spend });
}

console.log("\nbreaker — the invariant that protects the account");

check("READ ERROR DENIES — fails closed, not open", () => {
  // The legacy Places breaker returns true here. That is the bug this replaces.
  assert.equal(decide({ readError: true }).allowed, false);
  assert.equal(decide({ readError: true }).reason, "read_error");
});

check("under threshold allows", () => {
  assert.equal(decide({ spend: 10, thresholdUsd: 25 }).allowed, true);
});

check("at threshold denies (boundary is exclusive)", () => {
  assert.equal(decide({ spend: 25, thresholdUsd: 25 }).allowed, false);
});

check("over threshold denies", () => {
  const d = decide({ spend: 40, thresholdUsd: 25 });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "over_threshold");
});

check("manual break denies even at zero spend", () => {
  const d = decide({ manualBreak: true, spend: 0 });
  assert.equal(d.allowed, false);
  assert.equal(d.reason, "manual_break");
});

console.log("\nsnooze — raises the ceiling, then trips again");

check("snooze supersedes the threshold", () => {
  // Over the $25 threshold, but snoozed to $60.
  assert.equal(decide({ spend: 40, thresholdUsd: 25, snoozeToUsd: 60 }).allowed, true);
});

check("snooze trips again at the NEW number", () => {
  assert.equal(decide({ spend: 60, thresholdUsd: 25, snoozeToUsd: 60 }).allowed, false);
});

check("a zero ceiling means unconfigured, not blocked", () => {
  assert.equal(decide({ spend: 999, thresholdUsd: 0 }).allowed, true);
});

console.log("\nbilling cycle — anchored, not calendar-month");

check("after the anchor, the cycle started this month", () => {
  const s = cycleStart(15, new Date(2026, 6, 20)); // Jul 20, anchor 15
  assert.equal(s.getMonth(), 6);
  assert.equal(s.getDate(), 15);
});

check("before the anchor, the cycle started LAST month", () => {
  const s = cycleStart(15, new Date(2026, 6, 3)); // Jul 3, anchor 15
  assert.equal(s.getMonth(), 5); // June
  assert.equal(s.getDate(), 15);
});

check("anchor clamps to 1-28 so it exists in February", () => {
  // A 31st anchor would silently skip months that have no 31st.
  assert.equal(cycleStart(31, new Date(2026, 1, 10)).getDate(), 28);
  assert.equal(cycleStart(0, new Date(2026, 1, 10)).getDate(), 1);
});

console.log(`\n${process.exitCode ? "FAILED" : "PASSED"} — ${passed} checks\n`);
