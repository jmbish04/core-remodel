/**
 * Assert-style self-check for the room-geometry calculators.
 * Run: npx tsx src/backend/services/room-geometry/room-geometry.test.ts
 */
import assert from "node:assert";
import { computeRoomAreaSqFt, sumRoomAreaSqFt } from "./area";
import { toFeet } from "./dimensions";
import { computeRoomLinearFt, segmentLinearFt, sumRoomLinearFt } from "./linear-feet";

const room = (lengthFeet: number | null, lengthInches: number | null, widthFeet: number | null, widthInches: number | null) => ({
  lengthFeet,
  lengthInches,
  widthFeet,
  widthInches,
});

// toFeet — feet + inches → decimal feet; null only when both absent.
assert.equal(toFeet(10, 6), 10.5);
assert.equal(toFeet(3, null), 3);
assert.equal(toFeet(null, 6), 0.5);
assert.equal(toFeet(null, null), null);

// Area = length × width; null when a dimension is missing (never guessed).
assert.equal(computeRoomAreaSqFt(room(10, 0, 12, 0)), 120);
assert.equal(computeRoomAreaSqFt(room(10, 6, 12, 0)), 126); // 10.5 × 12
assert.equal(computeRoomAreaSqFt(room(10, 0, null, null)), null);

// Perimeter = 2 × (length + width); floor/home totals sum per-room.
assert.equal(computeRoomLinearFt(room(10, 0, 12, 0)), 44); // 2×(10+12)
assert.equal(computeRoomLinearFt(room(null, null, 12, 0)), null);
assert.equal(segmentLinearFt(8, 6), 8.5); // one wall run
assert.equal(sumRoomLinearFt([room(10, 0, 12, 0), room(5, 0, 5, 0)]), 64); // 44 + 20
assert.equal(sumRoomAreaSqFt([room(10, 0, 12, 0), room(5, 0, 5, 0)]), 145); // 120 + 25

// A room with unknown dimensions contributes 0 to a total, never NaN.
assert.equal(sumRoomLinearFt([room(10, 0, 12, 0), room(null, null, null, null)]), 44);

console.log("room-geometry: all assertions passed");
