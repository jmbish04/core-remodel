/**
 * Runnable self-check for the 0041 Phase 0 invariants. No framework:
 *   npx tsx src/backend/services/homeowner/homeowner-invariants.test.ts
 * Exits non-zero on the first failed assertion.
 *
 * These are not coverage tests. Each one guards a rule the plan calls
 * load-bearing, and each would fail loudly if that rule were quietly relaxed.
 */
import assert from "node:assert/strict";

import {
  blastRadius,
  canResolveImpact,
  computeNodeHealth,
  isOpenImpact,
  wouldCreateCycle,
} from "./node-health";
import { evaluateRoomReadiness, type RequiredDefinitionRow, type SpecFieldRow } from "./room-readiness";
import { canAdvanceStop, ROOM_STOPS, stopRank } from "./room-stop";

// ── The stop is high-water ──────────────────────────────────────────────────
// THE rule of the plan: no code path may lower a room's stop.

assert.equal(canAdvanceStop("SOURCING", "FIXTURES_LOCKED").ok, true, "forward move allowed");
assert.equal(canAdvanceStop("SOURCING", "SIGNED_OFF").ok, true, "skipping forward is allowed");
assert.equal(canAdvanceStop(null, "SOURCING").ok, true, "first entry allowed");

assert.equal(canAdvanceStop("FINISH_SPEC", "SOURCING").ok, false, "backward REFUSED");
assert.equal(canAdvanceStop("SIGNED_OFF", "FINISH_SPEC").ok, false, "backward REFUSED");
assert.equal(canAdvanceStop("ROUGH_IN", "ROUGH_IN").ok, false, "no-op refused");
assert.equal(canAdvanceStop("ROUGH_IN", "NOT_A_STOP").ok, false, "unknown stop refused");

// Every backward pair on the ladder, exhaustively — this is the invariant that
// must not erode as stops are added.
for (let from = 0; from < ROOM_STOPS.length; from += 1) {
  for (let to = 0; to < from; to += 1) {
    const verdict = canAdvanceStop(ROOM_STOPS[from], ROOM_STOPS[to]);
    assert.equal(verdict.ok, false, `${ROOM_STOPS[from]} -> ${ROOM_STOPS[to]} must be refused`);
  }
}
assert.ok(stopRank("SIGNED_OFF") > stopRank("SOURCING"), "ladder is ordered");

// ── roomReadiness: a null required field NEVER reports ready ────────────────
// The check the plan names explicitly.

const REQUIRED: RequiredDefinitionRow[] = [
  { id: 1, key: "shower_valve", name: "Shower valve" },
  { id: 2, key: "drywall_level", name: "Drywall finish level" },
];

const field = (over: Partial<SpecFieldRow> & { specDefinitionId: number }): SpecFieldRow => ({
  productId: null,
  materialId: null,
  valueText: null,
  valueCents: null,
  confidence: null,
  waivedReason: null,
  ...over,
});

// No rows at all.
let r = evaluateRoomReadiness(REQUIRED, []);
assert.equal(r.ready, false, "empty room is not ready");
assert.equal(r.gaps.length, 2);
assert.equal(r.gaps[0].reason, "missing_field");

// A row exists but carries no value.
r = evaluateRoomReadiness(REQUIRED, [
  field({ specDefinitionId: 1, confidence: "known" }),
  field({ specDefinitionId: 2, productId: 9, confidence: "known" }),
]);
assert.equal(r.ready, false, "a known-but-empty field is NOT satisfied");
assert.equal(r.gaps[0].reason, "no_value");

// Values present but unverified — the case that must never pass.
for (const confidence of ["assumed", "range", "unknown"]) {
  r = evaluateRoomReadiness(REQUIRED, [
    field({ specDefinitionId: 1, productId: 7, confidence }),
    field({ specDefinitionId: 2, valueText: "Level 5", confidence: "known" }),
  ]);
  assert.equal(r.ready, false, `confidence "${confidence}" must not satisfy the threshold`);
  assert.equal(r.gaps[0].reason, "unverified");
  assert.equal(r.gaps[0].confidence, confidence);
}

// Fully known — ready.
r = evaluateRoomReadiness(REQUIRED, [
  field({ specDefinitionId: 1, productId: 7, confidence: "known" }),
  field({ specDefinitionId: 2, valueText: "Level 5", confidence: "known" }),
]);
assert.equal(r.ready, true, "all required known => ready");
assert.equal(r.satisfiedCount, 2);
assert.equal(r.waivedCount, 0);

// A deliberate unknown, waived with a reason — the gate is not a wall.
r = evaluateRoomReadiness(REQUIRED, [
  field({ specDefinitionId: 1, confidence: "unknown", waivedReason: "picking the pull later" }),
  field({ specDefinitionId: 2, valueText: "Level 5", confidence: "known" }),
]);
assert.equal(r.ready, true, "an explicit waiver satisfies");
assert.equal(r.waivedCount, 1, "and is counted as waived, not as known");

// An empty-string waiver is not a waiver.
r = evaluateRoomReadiness(REQUIRED, [
  field({ specDefinitionId: 1, confidence: "unknown", waivedReason: "   " }),
  field({ specDefinitionId: 2, valueText: "Level 5", confidence: "known" }),
]);
assert.equal(r.ready, false, "a blank waiver reason does not satisfy");

// Whitespace-only text is not a value.
r = evaluateRoomReadiness(REQUIRED, [
  field({ specDefinitionId: 1, valueText: "   ", confidence: "known" }),
  field({ specDefinitionId: 2, valueText: "Level 5", confidence: "known" }),
]);
assert.equal(r.ready, false, "whitespace is not a value");

// Zero cents IS a value — a legitimately free line item must not read as blank.
r = evaluateRoomReadiness(REQUIRED, [
  field({ specDefinitionId: 1, valueCents: 0, valueText: "$0.00", confidence: "known" }),
  field({ specDefinitionId: 2, valueText: "Level 5", confidence: "known" }),
]);
assert.equal(r.ready, true, "zero cents is a real value, not an absence");

// No requirements configured => vacuously ready. Stated explicitly so the
// behaviour is a decision rather than an accident.
assert.equal(evaluateRoomReadiness([], []).ready, true, "no required specs => ready");

// ── not_in_scope is a THIRD state, not a flavour of unready ─────────────────
// The bug this guards: roomReadiness() required every threshold spec on EVERY
// room, so a room nobody is touching sat permanently un-ready asking for a
// shower valve. On a real 19-room house that made the threshold meaningless.

r = evaluateRoomReadiness(REQUIRED, [], { inScope: false });
assert.equal(r.status, "not_in_scope", "a room with no intent is NOT in scope");
assert.equal(r.ready, false, "and it is not 'ready' either — the question does not apply");
assert.equal(r.gaps.length, 0, "an out-of-scope room reports NO gaps to chase");
assert.equal(r.requiredCount, 0, "and requires nothing");

// Out-of-scope wins even when specs would otherwise be missing.
r = evaluateRoomReadiness(
  REQUIRED,
  [field({ specDefinitionId: 1, confidence: "unknown" })],
  { inScope: false },
);
assert.equal(r.status, "not_in_scope", "scope is decided before requirements are counted");

// In scope is the default, so existing callers are unchanged.
assert.equal(evaluateRoomReadiness(REQUIRED, []).status, "blocked", "default is in-scope");
assert.equal(
  evaluateRoomReadiness(REQUIRED, [], { inScope: true }).status,
  "blocked",
  "explicit in-scope with gaps is blocked, not not_in_scope",
);

// status and ready never disagree.
for (const scenario of [
  evaluateRoomReadiness(REQUIRED, [], { inScope: false }),
  evaluateRoomReadiness(REQUIRED, []),
  evaluateRoomReadiness([], []),
]) {
  assert.equal(
    scenario.ready,
    scenario.status === "ready",
    "ready must be true if and only if status is ready",
  );
}

// ── nodeHealth: derived, and forecasts do not colour a node ─────────────────

assert.equal(isOpenImpact("active"), true);
assert.equal(isOpenImpact("mitigating"), true);
assert.equal(isOpenImpact("forecast"), false, "a forecast must not count as open");
assert.equal(isOpenImpact("resolved"), false);
assert.equal(isOpenImpact("dismissed"), false);

const room = { kind: "room", id: 42 };

// A forecast alone leaves the node ok — otherwise the diagram cries wolf.
let h = computeNodeHealth(
  room,
  [{ id: 1, status: "forecast" }],
  [{ impactId: 1, targetKind: "room", targetId: 42, effect: "delays" }],
);
assert.equal(h.level, "ok", "a forecast does not make a node unhealthy");
assert.deepEqual(h.openImpactIds, []);

// A resolved impact stops counting.
h = computeNodeHealth(
  room,
  [{ id: 1, status: "resolved" }],
  [{ impactId: 1, targetKind: "room", targetId: 42, effect: "blocks" }],
);
assert.equal(h.level, "ok", "resolving clears the node");

// Effects escalate correctly, and the worst one wins.
h = computeNodeHealth(
  room,
  [
    { id: 1, status: "active" },
    { id: 2, status: "active" },
  ],
  [
    { impactId: 1, targetKind: "room", targetId: 42, effect: "informs" },
    { impactId: 2, targetKind: "room", targetId: 42, effect: "delays" },
  ],
);
assert.equal(h.level, "at_risk");
assert.equal(h.openImpactIds.length, 2);

h = computeNodeHealth(
  room,
  [{ id: 3, status: "active" }],
  [{ impactId: 3, targetKind: "room", targetId: 42, effect: "blocks" }],
);
assert.equal(h.level, "blocked", "blocks is the worst level");

// Another node's impact does not bleed across.
h = computeNodeHealth(
  room,
  [{ id: 4, status: "active" }],
  [{ impactId: 4, targetKind: "room", targetId: 99, effect: "blocks" }],
);
assert.equal(h.level, "ok", "impacts on other nodes do not affect this one");

// ── Blocking: cannot resolve while something blocking is open ───────────────

const impacts = [
  { id: 1, status: "active" }, // the blocker
  { id: 2, status: "active" }, // blocked by 1
];
const blocks = [{ blockingImpactId: 1, blockedImpactId: 2 }];

let verdict = canResolveImpact(2, impacts, blocks);
assert.equal(verdict.ok, false, "blocked impact cannot resolve");
assert.deepEqual(verdict.blockedBy, [1]);

verdict = canResolveImpact(1, impacts, blocks);
assert.equal(verdict.ok, true, "the blocker itself can resolve");

// Once the blocker resolves, the blocked one is free.
verdict = canResolveImpact(2, [{ id: 1, status: "resolved" }, { id: 2, status: "active" }], blocks);
assert.equal(verdict.ok, true, "resolving the blocker unblocks");

// ── Blast radius reaches through blocking edges ─────────────────────────────

const radius = blastRadius(
  room,
  [
    { id: 1, status: "active" },
    { id: 2, status: "active" },
  ],
  [
    { impactId: 1, targetKind: "room", targetId: 42, effect: "delays" },
    { impactId: 2, targetKind: "permit", targetId: 7, effect: "blocks" },
  ],
  [{ blockingImpactId: 1, blockedImpactId: 2 }],
);
const kinds = radius.map((n) => `${n.node.kind}:${n.node.id}`).sort();
assert.deepEqual(kinds, ["permit:7", "room:42"], "radius reaches the blocked impact's node");

// ── Cycle guard ─────────────────────────────────────────────────────────────

assert.equal(wouldCreateCycle(1, 1, []), true, "self-block is a cycle");
assert.equal(wouldCreateCycle(2, 1, [{ blockingImpactId: 1, blockedImpactId: 2 }]), true, "A->B then B->A is a cycle");
assert.equal(wouldCreateCycle(3, 1, [{ blockingImpactId: 1, blockedImpactId: 2 }]), false, "unrelated edge is fine");
assert.equal(
  wouldCreateCycle(
    3,
    1,
    [
      { blockingImpactId: 1, blockedImpactId: 2 },
      { blockingImpactId: 2, blockedImpactId: 3 },
    ],
  ),
  true,
  "transitive loop detected",
);

console.log("homeowner invariants: all assertions passed");
