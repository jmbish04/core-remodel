// Pure self-check of the showroom-import dedupe/adopt decision (no D1, no network).
// Mirrors the branch in import_showroom_from_place.ts / create_showroom.ts:
//   exact placeId already on a row      -> "exists"   (report duplicate)
//   fuzzy match, matched row HAS placeId -> "exists"   (already located = dup)
//   fuzzy match, matched row NO placeId  -> "adopt"    (bare stub: fill location)
//   no match                             -> "create"   (new row)
// Run: node scripts/qc/pr_dedupe_adopt_logic.mjs
import assert from "node:assert";

function decide({ exactPlaceIdRow, fuzzyMatch }) {
  if (exactPlaceIdRow) return "exists";
  if (fuzzyMatch?.placeId) return "exists";
  if (fuzzyMatch) return "adopt";
  return "create";
}

assert.equal(decide({ exactPlaceIdRow: { id: 1 }, fuzzyMatch: null }), "exists");
assert.equal(decide({ exactPlaceIdRow: null, fuzzyMatch: { id: 2, placeId: "ChIJ_other" } }), "exists");
assert.equal(decide({ exactPlaceIdRow: null, fuzzyMatch: { id: 3, placeId: null } }), "adopt");
assert.equal(decide({ exactPlaceIdRow: null, fuzzyMatch: null }), "create");
// A bare stub must NOT be reported as a duplicate — the whole point of this change.
assert.notEqual(decide({ exactPlaceIdRow: null, fuzzyMatch: { id: 3, placeId: null } }), "exists");

console.log("OK: dedupe/adopt decision table holds");
