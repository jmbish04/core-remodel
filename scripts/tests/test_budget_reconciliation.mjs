// Run: npx tsx scripts/tests/test_budget_reconciliation.mjs
//
// Deterministic, assert-based check of `appendRejectionNote` — the bounded,
// deduped note-append used by POST /reconciliation/:lineItemId/reject
// (Budget Command Center). Unlike budget-grid-math.ts / budget-compliance.ts,
// this route file has no Worker-bundle-size concern (it isn't near the 10 MiB
// cap), so the pure helper stays exported in place; this script just
// dynamically imports it the same way the other budget test scripts do.
import assert from "node:assert";

const { appendRejectionNote } = await import(
  "../../src/backend/api/routes/budget-reconciliation.ts"
);

assert.strictEqual(
  appendRejectionNote("existing", undefined),
  "existing",
  "no reason -> notes unchanged",
);
assert.strictEqual(
  appendRejectionNote(null, "wrong room"),
  "Rejected: wrong room",
  "first reject with no prior notes",
);
assert.strictEqual(
  appendRejectionNote("prior note", "wrong room"),
  "prior note\nRejected: wrong room",
  "appends to existing notes",
);

const once = appendRejectionNote(null, "dup");
assert.strictEqual(appendRejectionNote(once, "dup"), once, "identical repeat is a no-op");
assert.strictEqual(
  appendRejectionNote(once, "other"),
  "Rejected: dup\nRejected: other",
  "a different reason still appends",
);

// Bounded growth: repeated distinct rejections must not grow the field
// forever (finding #5 — unbounded append).
let notes = null;
for (let i = 0; i < 25; i++) notes = appendRejectionNote(notes, `reason ${i}`);
assert.strictEqual(notes.split("\n").length, 20, "capped at 20 lines");
assert.ok(notes.includes("reason 24"), "keeps the most recent entry");
assert.ok(!notes.split("\n").includes("Rejected: reason 0"), "drops the oldest entry once capped");

console.log("[test_budget_reconciliation] all assertions passed");
