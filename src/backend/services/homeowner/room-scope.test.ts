/**
 * Runnable self-check for resolveScope (0043 §5b). No framework:
 *   npx tsx src/backend/services/homeowner/room-scope.test.ts
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";

import { chunk, resolveScope, ScopeError, type RoomRow } from "./room-scope";

// A small house: floor 1 has rooms 1,2 (2 inactive); floor 2 has 3,4,5.
const HOUSE: RoomRow[] = [
  { id: 1, floorId: 1, isActive: true },
  { id: 2, floorId: 1, isActive: false }, // merged / deactivated
  { id: 3, floorId: 2, isActive: true },
  { id: 4, floorId: 2, isActive: true },
  { id: 5, floorId: 2, isActive: true },
];

// ── project => every active room, sorted, no inactive ───────────────────────
let r = resolveScope({ scope: "project" }, HOUSE);
assert.deepEqual(r.roomIds, [1, 3, 4, 5], "project resolves to all ACTIVE rooms");
assert.ok(!r.roomIds.includes(2), "the inactive room never appears");

// ── floor => only that floor's active rooms ─────────────────────────────────
r = resolveScope({ scope: "floor", scopeRefId: 2 }, HOUSE);
assert.deepEqual(r.roomIds, [3, 4, 5], "floor 2's active rooms");
r = resolveScope({ scope: "floor", scopeRefId: 1 }, HOUSE);
assert.deepEqual(r.roomIds, [1], "floor 1 excludes its inactive room 2");

// A floor with no active rooms is a valid empty result, not an error.
r = resolveScope({ scope: "floor", scopeRefId: 999 }, HOUSE);
assert.deepEqual(r.roomIds, [], "an empty floor resolves to nothing, no throw");

// ── floor WITHOUT scopeRefId must throw, never silently widen ───────────────
// This is the load-bearing safety rule: a missing floor id must not become
// "all rooms".
assert.throws(
  () => resolveScope({ scope: "floor" }, HOUSE),
  ScopeError,
  "floor with no scopeRefId throws",
);
assert.throws(
  () => resolveScope({ scope: "floor", scopeRefId: null }, HOUSE),
  ScopeError,
  "floor with null scopeRefId throws",
);

// ── explicit rooms => active kept, inactive and unknown reported not dropped ─
r = resolveScope({ scope: "rooms", roomIds: [3, 4] }, HOUSE);
assert.deepEqual(r.roomIds, [3, 4]);

r = resolveScope({ scope: "rooms", roomIds: [3, 2, 99] }, HOUSE);
assert.deepEqual(r.roomIds, [3], "only the active one is included");
assert.deepEqual(r.skipped.inactive, [2], "inactive is REPORTED, not silently dropped");
assert.deepEqual(r.skipped.unknown, [99], "unknown is REPORTED, not silently dropped");

// ── de-dup and deterministic order ──────────────────────────────────────────
r = resolveScope({ scope: "rooms", roomIds: [5, 3, 5, 4, 3] }, HOUSE);
assert.deepEqual(r.roomIds, [3, 4, 5], "de-duplicated and sorted ascending");

// order of the input house must not change the output
const shuffled = [...HOUSE].reverse();
assert.deepEqual(
  resolveScope({ scope: "project" }, shuffled).roomIds,
  [1, 3, 4, 5],
  "output is stable regardless of input order",
);

// ── empty request is empty, not an error ────────────────────────────────────
r = resolveScope({ scope: "rooms", roomIds: [] }, HOUSE);
assert.deepEqual(r.roomIds, [], "no rooms requested => empty");

// ── chunk defaults to 20 and never exceeds it ───────────────────────────────
const twentyThree = Array.from({ length: 23 }, (_, i) => i + 1);
const chunks = chunk(twentyThree);
assert.equal(chunks.length, 2, "23 items => 2 chunks at the default of 20");
assert.equal(chunks[0].length, 20);
assert.equal(chunks[1].length, 3);
assert.ok(
  chunks.every((c) => c.length <= 20),
  "no chunk exceeds 20 — the D1 param cap depends on it",
);
assert.deepEqual(chunk([1, 2, 3], 1).length, 3, "size 1 chunks each item");
assert.deepEqual(chunk([], 5), [], "empty input => no chunks");
assert.throws(() => chunk([1], 0), ScopeError, "size 0 is rejected, not an infinite loop");

console.log("room-scope: all assertions passed");
