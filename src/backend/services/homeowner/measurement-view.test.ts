/**
 * Runnable self-check for measurementView (0043). No framework:
 *   npx tsx src/backend/services/homeowner/measurement-view.test.ts
 */
import assert from "node:assert/strict";

import { measurementView, type MeasurementRowInput, type WallRecord } from "./measurement-view";

const KEYS = [
  "walls",
  "computeAreaSqFt",
  "areaSqFtOverride",
  "areaSqFtOverrideNotes",
  "areaSqFtOverrideCalculation",
  "computeLinearFt",
  "perimeterSource",
  "ceilingHeightFt",
  "effectiveAreaSqFt",
  "effectiveAreaSource",
  "confidence",
];

const row = (over: Partial<MeasurementRowInput> = {}): MeasurementRowInput => ({
  lengthInches: null,
  widthInches: null,
  ceilingHeightInches: null,
  perimeterInches: null,
  areaSqFtOverride: null,
  areaSqFtOverrideNotes: null,
  areaSqFtOverrideCalculation: null,
  confidence: null,
  ...over,
});

const wall = (over: Partial<WallRecord> & { id: number }): WallRecord => ({
  label: null,
  lengthInches: null,
  heightInches: null,
  wallKind: "full",
  loadBearing: "unknown",
  ...over,
});

// ── SAME SHAPE ALWAYS — the whole point ─────────────────────────────────────
// Every case returns identical keys; absent data is null, never a missing key.
for (const [label, m, walls] of [
  ["null row", null, []],
  ["empty row", row(), []],
  ["full row", row({ lengthInches: 141, widthInches: 270, ceilingHeightInches: 108 }), [wall({ id: 1, lengthInches: 141 })]],
  ["override", row({ lengthInches: 100, widthInches: 100, areaSqFtOverride: 60 }), []],
] as const) {
  const v = measurementView(m, walls as WallRecord[]);
  assert.deepEqual(Object.keys(v).sort(), [...KEYS].sort(), `${label}: identical key set`);
  assert.ok(Array.isArray(v.walls), `${label}: walls is always an array, never null`);
}

// ── computed rectangle ──────────────────────────────────────────────────────
let v = measurementView(row({ lengthInches: 141, widthInches: 270 }), []);
assert.equal(v.computeAreaSqFt, 264.38, "141 x 270 in = 264.38 sqft");
assert.equal(v.effectiveAreaSqFt, 264.38, "no override => effective is the computed value");
assert.equal(v.effectiveAreaSource, "computed");
assert.equal(v.areaSqFtOverride, null, "and the override is null, present as a key");

// ── override wins, but computed stays VISIBLE (no hiding) ────────────────────
v = measurementView(
  row({
    lengthInches: 120,
    widthInches: 120,
    areaSqFtOverride: 78,
    areaSqFtOverrideNotes: "L-shaped",
    areaSqFtOverrideCalculation: "10x8 - 2x1",
  }),
  [],
);
assert.equal(v.computeAreaSqFt, 100, "the rectangular compute is STILL returned");
assert.equal(v.areaSqFtOverride, 78, "the override is returned");
assert.equal(v.effectiveAreaSqFt, 78, "override wins for the effective value");
assert.equal(v.effectiveAreaSource, "override");
assert.equal(v.areaSqFtOverrideNotes, "L-shaped", "the WHY is returned");
assert.equal(v.areaSqFtOverrideCalculation, "10x8 - 2x1", "the HOW is returned");

// ── perimeter: walls win, and the source is named ───────────────────────────
v = measurementView(row({ lengthInches: 141, widthInches: 270, perimeterInches: 999 }), [
  wall({ id: 1, lengthInches: 141 }),
  wall({ id: 2, lengthInches: 270 }),
  wall({ id: 3, lengthInches: 141 }),
  wall({ id: 4, lengthInches: 270 }),
]);
assert.equal(v.computeLinearFt, 68.5, "sum of walls 822 in = 68.5 ft — correct for ANY shape");
assert.equal(v.perimeterSource, "walls", "walls beat a measured perimeter and the estimate");

// measured perimeter when no wall lengths
v = measurementView(row({ lengthInches: 141, widthInches: 270, perimeterInches: 900 }), []);
assert.equal(v.computeLinearFt, 75, "measured perimeter 900 in = 75 ft");
assert.equal(v.perimeterSource, "measured");

// rectangular estimate when neither walls nor measured perimeter
v = measurementView(row({ lengthInches: 141, widthInches: 270 }), []);
assert.equal(v.computeLinearFt, 68.5, "2*(141+270) in = 68.5 ft estimate");
assert.equal(v.perimeterSource, "rectangular_estimate", "and it is LABELLED an estimate, not passed as measured");

// unavailable
v = measurementView(row(), []);
assert.equal(v.computeLinearFt, null);
assert.equal(v.perimeterSource, "unavailable");
assert.equal(v.effectiveAreaSource, "unavailable");

// ── confidence propagates, never upgrades ───────────────────────────────────
v = measurementView(row({ lengthInches: 141, widthInches: 270, confidence: "assumed" }), []);
assert.equal(v.confidence, "assumed", "confidence is passed through, not upgraded by computing");

console.log("measurement-view: all assertions passed");
