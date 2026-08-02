/**
 * Runnable self-check for resolveApplicability (0043 §5c). No framework:
 *   npx tsx src/backend/services/homeowner/applicability.test.ts
 */
import assert from "node:assert/strict";

import { resolveApplicability, type MatchedRule } from "./applicability";

const rule = (over: Partial<MatchedRule> & { resolution: MatchedRule["resolution"] }): MatchedRule => ({
  key: over.key ?? "r",
  rationale: over.rationale ?? "because",
  strength: over.strength ?? "usually",
  ...over,
});

// ── no rules => auto_apply, no question ─────────────────────────────────────
let o = resolveApplicability([]);
assert.equal(o.resolution, "auto_apply", "absence of a reason to ask is permission to proceed");
assert.equal(o.needsHomeowner, false);
assert.equal(o.blocks, false);
assert.equal(o.prompt, null);

// ── auto_apply alone ────────────────────────────────────────────────────────
o = resolveApplicability([rule({ key: "floor_continue", resolution: "auto_apply" })]);
assert.equal(o.resolution, "auto_apply");
assert.equal(o.needsHomeowner, false);

// ── auto_exclude does NOT ask ───────────────────────────────────────────────
o = resolveApplicability([rule({ key: "hardwood_no_bath", resolution: "auto_exclude" })]);
assert.equal(o.resolution, "auto_exclude");
assert.equal(o.needsHomeowner, false, "auto_exclude states an assumption, it does not interrupt");
assert.equal(o.prompt, null, "no question => no prompt");

// ── must_confirm asks, does not block, shows the rationale ──────────────────
o = resolveApplicability([
  rule({ key: "tile_into_bath", resolution: "must_confirm", rationale: "Continue tile into the bathrooms?" }),
]);
assert.equal(o.needsHomeowner, true, "must_confirm asks");
assert.equal(o.blocks, false, "but does not block progress");
assert.equal(o.prompt, "Continue tile into the bathrooms?", "the rationale IS the prompt");

// ── must_specify blocks ─────────────────────────────────────────────────────
o = resolveApplicability([rule({ key: "stair_strategy", resolution: "must_specify" })]);
assert.equal(o.blocks, true, "must_specify cannot proceed until answered");
assert.equal(o.needsHomeowner, true);

// ── precedence: a question beats a silent apply ─────────────────────────────
// The load-bearing rule. tile-into-bath (confirm) + whole-floor (apply) must NOT
// silently apply past a real ambiguity.
o = resolveApplicability([
  rule({ key: "whole_floor", resolution: "auto_apply" }),
  rule({ key: "tile_into_bath", resolution: "must_confirm", rationale: "Ask." }),
]);
assert.equal(o.resolution, "must_confirm", "the question wins over the silent apply");
assert.equal(o.decidedBy, "tile_into_bath");

// full precedence order, shuffled input
o = resolveApplicability([
  rule({ key: "a", resolution: "auto_apply" }),
  rule({ key: "b", resolution: "must_specify" }),
  rule({ key: "c", resolution: "auto_exclude" }),
  rule({ key: "d", resolution: "must_confirm" }),
]);
assert.equal(o.resolution, "must_specify", "most-blocking wins regardless of order");
assert.equal(o.blocks, true);

// exclude beats apply
o = resolveApplicability([
  rule({ key: "a", resolution: "auto_apply" }),
  rule({ key: "b", resolution: "auto_exclude" }),
]);
assert.equal(o.resolution, "auto_exclude", "exclude beats apply — do not extend where a rule says not to");

// every matched rule is reported for transparency
o = resolveApplicability([
  rule({ key: "x", resolution: "auto_apply" }),
  rule({ key: "y", resolution: "must_confirm" }),
]);
assert.equal(o.matched.length, 2, "all matches surfaced, not just the winner");

console.log("applicability: all assertions passed");
