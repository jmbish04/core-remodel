/**
 * @fileoverview Runnable check for the WorkItem pure logic — 0028 P0.
 *
 *   npx tsx scripts/checks/pmo-types.check.ts
 *
 * `deriveHealth` is the one branchy function in the contract and it is security-
 * adjacent only in that a wrong "on_track" hides a slipping task. The id
 * round-trip matters because ids can contain colons (a slug could), and a naive
 * split would corrupt them. The QC script exercises the adapters against live
 * D1; this covers the logic that has no rows to test against (planning is often
 * empty) and the edge cases a live test would not hit.
 */
import assert from "node:assert/strict";

import { deriveHealth, parseWorkItemId, workItemId } from "../../src/shared/pmo/types";

let failures = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n    ${(err as Error).message.split("\n")[0]}`);
  }
};

console.log("\npmo types\n");
const TODAY = "2026-07-22";

check("blocked status → blocked health, regardless of dates", () => {
  assert.equal(deriveHealth({ status: "blocked", dueAt: "2099-01-01" }, TODAY), "blocked");
});

check("done is always on_track, even past due", () => {
  assert.equal(deriveHealth({ status: "done", dueAt: "2000-01-01" }, TODAY), "on_track");
});

check("a past due date on an open task → at_risk", () => {
  assert.equal(deriveHealth({ status: "in_progress", dueAt: "2026-07-01" }, TODAY), "at_risk");
});

check("a future due date → on_track", () => {
  assert.equal(deriveHealth({ status: "todo", dueAt: "2026-12-01" }, TODAY), "on_track");
});

check("no due date → on_track (not at_risk)", () => {
  assert.equal(deriveHealth({ status: "todo", dueAt: null }, TODAY), "on_track");
});

check("a late dependency makes an otherwise-fine task at_risk", () => {
  assert.equal(deriveHealth({ status: "in_progress", dueAt: null }, TODAY, true), "at_risk");
});

check("id round-trips, and splits on the FIRST colon only", () => {
  assert.equal(workItemId("plan", 42), "plan:42");
  assert.deepEqual(parseWorkItemId("plan:42"), { source: "plan", nativeId: "42" });
  // A native id containing a colon (e.g. a namespaced slug) survives.
  assert.deepEqual(parseWorkItemId("planning:a:b:c"), { source: "planning", nativeId: "a:b:c" });
});

check("a malformed id throws rather than returning garbage", () => {
  assert.throws(() => parseWorkItemId("nocolon"));
});

console.log(failures === 0 ? "\nall passed\n" : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
