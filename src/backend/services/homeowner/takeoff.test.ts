/**
 * Runnable self-check for the 0043 §5c takeoff calculators. No framework:
 *   npx tsx src/backend/services/homeowner/takeoff.test.ts
 * Exits non-zero on the first failed assertion.
 *
 * These are not coverage tests. Each block guards one rule from the plan, with
 * hand-computed expected values, so that quietly relaxing the rule fails the
 * suite instead of shifting a number nobody re-derives.
 */
import assert from "node:assert/strict";

import {
  baseboardTakeoff,
  flooringTakeoff,
  floorAreaSqFt,
  openingCountTakeoff,
  paintTakeoff,
  PAINT_COVERAGE_SQFT_PER_GALLON,
  type MaterialTypeInput,
  type MeasurementConfidence,
  type MeasurementInput,
  type OpeningInput,
} from "./takeoff";

const measurement = (over: Partial<MeasurementInput> = {}): MeasurementInput => ({
  lengthInches: null,
  widthInches: null,
  ceilingHeightInches: null,
  perimeterInches: null,
  areaSqFtOverride: null,
  confidence: "known",
  ...over,
});

const opening = (
  openingKind: OpeningInput["openingKind"],
  widthInches: number | null,
  heightInches: number | null,
): OpeningInput => ({ openingKind, widthInches, heightInches });

const FLOORING: MaterialTypeInput = { takeoffUnit: "sqft", defaultWasteFactor: 0.1 };
const TILE: MaterialTypeInput = { takeoffUnit: "sqft", defaultWasteFactor: 0.15 };
const PAINT: MaterialTypeInput = { takeoffUnit: "gallons", defaultWasteFactor: 0.1 };
const BASE: MaterialTypeInput = { takeoffUnit: "linear_ft", defaultWasteFactor: 0.1 };

const ALL_CONFIDENCES: MeasurementConfidence[] = ["known", "assumed", "range", "unknown"];

const hasBasisMentioning = (basis: string[], needle: string): boolean =>
  basis.some((line) => line.toLowerCase().includes(needle.toLowerCase()));

// A 12ft × 10ft room, 9ft ceiling, 40 linear ft of wall.
const ROOM = measurement({
  lengthInches: 144,
  widthInches: 120,
  ceilingHeightInches: 108,
  perimeterInches: 480,
  confidence: "known",
});

// ── Rule 1: inches in, FEET out ─────────────────────────────────────────────
// 144 × 120 inches is 17,280 square INCHES. Returning that as a takeoff would be
// off by a factor of 144 and would look plausible on a screen.

let area = floorAreaSqFt(ROOM);
assert.equal(area.sqft, 120, "144in × 120in = 120 SQUARE FEET, not 17280");
assert.notEqual(area.sqft, 17280, "square inches must never escape this module");

// A 480in perimeter is 40 linear feet, never 480.
let base = baseboardTakeoff(measurement({ perimeterInches: 480 }), [], BASE);
assert.equal(base.quantity, 44, "480in ÷ 12 = 40 linear ft, × 1.10 waste = 44.00");
assert.ok(base.quantity !== null && base.quantity < 480, "linear feet, not inches");

// ── Rule 2: areaSqFtOverride wins over length × width, and says so ──────────
// The L-shaped lower foyer is 77.28 sq ft; no length × width produces that.

area = floorAreaSqFt(
  measurement({ lengthInches: 144, widthInches: 120, areaSqFtOverride: 77.28 }),
);
assert.equal(area.sqft, 77.28, "the override wins over length × width");
assert.ok(hasBasisMentioning(area.basis, "override"), "and the basis names the override");
assert.ok(
  hasBasisMentioning(area.basis, "NOT used"),
  "the basis states that length × width was present and ignored",
);

area = floorAreaSqFt(measurement({ lengthInches: 144, widthInches: 120 }));
assert.equal(area.sqft, 120, "no override falls back to length × width");
assert.ok(
  hasBasisMentioning(area.basis, "no area override"),
  "and the basis names the fallback, so a reader can tell which of the two they have",
);

// Missing either dimension, with no override, is a gap — never a zero.
assert.equal(floorAreaSqFt(measurement({ lengthInches: 144 })).sqft, null, "no width => null");
assert.equal(floorAreaSqFt(measurement({ widthInches: 120 })).sqft, null, "no length => null");
assert.equal(floorAreaSqFt(measurement()).sqft, null, "no dimensions at all => null");

// Zero and negative dimensions are absences, not values. A room with zero length
// does not exist, and 0 × 120 = 0 sqft is a number-shaped lie.
assert.equal(
  floorAreaSqFt(measurement({ lengthInches: 0, widthInches: 120 })).sqft,
  null,
  "zero length is an absent measurement, not an area of 0",
);
assert.equal(
  floorAreaSqFt(measurement({ lengthInches: -144, widthInches: 120 })).sqft,
  null,
  "a negative dimension is an absent measurement",
);

// ── Flooring: area × (1 + waste) ────────────────────────────────────────────

let floor = flooringTakeoff(ROOM, FLOORING);
assert.equal(floor.quantity, 132, "120 sqft × 1.10 = 132.00 sqft");
assert.equal(floor.unit, "sqft");
assert.equal(floor.wasteFactor, 0.1, "the waste factor used is reported, not hidden");
assert.equal(floor.orderReady, true, "known measurement + every input present => order-ready");

// Waste is a real multiplier, not decoration: tile's 0.15 must differ from 0.10.
assert.equal(flooringTakeoff(ROOM, TILE).quantity, 138, "120 sqft × 1.15 = 138.00 sqft");
assert.equal(
  flooringTakeoff(ROOM, { takeoffUnit: "sqft", defaultWasteFactor: 0 }).quantity,
  120,
  "a zero waste factor leaves the area untouched",
);

// The override flows through the takeoff, not just through floorAreaSqFt.
assert.equal(
  flooringTakeoff(
    measurement({ lengthInches: 144, widthInches: 120, areaSqFtOverride: 77.28 }),
    FLOORING,
  ).quantity,
  85.01,
  "77.28 sqft × 1.10 = 85.008 => 85.01",
);

// A missing input yields no number at all.
floor = flooringTakeoff(measurement({ lengthInches: 144 }), FLOORING);
assert.equal(floor.quantity, null, "missing width => no flooring quantity");
assert.equal(floor.orderReady, false);
assert.ok(floor.basis.length > 0, "and a basis line explaining the gap");

// A nonsense waste factor applies no waste rather than producing NaN.
floor = flooringTakeoff(ROOM, { takeoffUnit: "sqft", defaultWasteFactor: Number.NaN });
assert.equal(floor.quantity, 120, "an unusable waste factor is ignored, not multiplied in");
assert.equal(floor.wasteFactor, 0);
assert.ok(hasBasisMentioning(floor.basis, "ignored"), "and the basis says it was ignored");
assert.equal(
  flooringTakeoff(ROOM, { takeoffUnit: "sqft", defaultWasteFactor: -0.5 }).quantity,
  120,
  "a negative waste factor is ignored too — it would under-order",
);

// ── Rule 3: perimeter is REQUIRED and is not derivable from area ────────────
// The load-bearing gap. Two rooms of equal area have different perimeters, so an
// area override must NOT rescue a paint or baseboard takeoff.

const NO_PERIMETER = measurement({
  lengthInches: 144,
  widthInches: 120,
  ceilingHeightInches: 108,
  areaSqFtOverride: 500,
  perimeterInches: null,
});

let paint = paintTakeoff(NO_PERIMETER, [], 2, PAINT);
assert.equal(paint.quantity, null, "no perimeter => NO paint quantity, even with an area override");
assert.equal(paint.orderReady, false);
assert.ok(
  hasBasisMentioning(paint.basis, "perimeter"),
  "and the basis explains the gap by name",
);
assert.ok(
  hasBasisMentioning(paint.basis, "cannot be derived"),
  "stating explicitly that perimeter cannot be derived from area",
);

base = baseboardTakeoff(NO_PERIMETER, [], BASE);
assert.equal(base.quantity, null, "no perimeter => NO baseboard quantity");
assert.ok(hasBasisMentioning(base.basis, "cannot be derived"), "same reason, stated");

// Paint also needs the ceiling height.
paint = paintTakeoff(measurement({ perimeterInches: 480 }), [], 2, PAINT);
assert.equal(paint.quantity, null, "no ceiling height => no paint quantity");
assert.ok(hasBasisMentioning(paint.basis, "ceilingHeightInches"), "named in the basis");

// Baseboard does NOT need a ceiling height — a base run has no height component.
assert.equal(
  baseboardTakeoff(measurement({ perimeterInches: 480 }), [], BASE).quantity,
  44,
  "baseboard needs only the perimeter",
);

// ── Rule 4: paint = (perimeter × height − openings) × coats ÷ coverage × waste ──
// 40 lf × 9 ft = 360 sqft gross.
// window 36×48 = 12.00 sqft; interior_door 32×80 = 17.7778 sqft; niche excluded.
// net 330.2222 × 2 coats = 660.4444 ÷ 350 = 1.887013 × 1.10 = 2.0757 => 2.08

const OPENINGS: OpeningInput[] = [
  opening("window", 36, 48),
  opening("interior_door", 32, 80),
  opening("niche", 24, 24),
];

paint = paintTakeoff(ROOM, OPENINGS, 2, PAINT);
assert.equal(paint.quantity, 2.08, "hand-computed: 2.08 gallons");
assert.equal(paint.unit, "gallons");
assert.equal(paint.wasteFactor, 0.1);
assert.equal(paint.orderReady, true);
assert.equal(PAINT_COVERAGE_SQFT_PER_GALLON, 350, "the coverage constant is named and exported");
assert.ok(
  hasBasisMentioning(paint.basis, "350 sqft/gallon"),
  "the basis reports the coverage figure actually used",
);

// Openings must actually reduce the number. Ignoring them gives 2.26.
const paintNoOpenings = paintTakeoff(ROOM, [], 2, PAINT);
assert.equal(paintNoOpenings.quantity, 2.26, "720 sqft ÷ 350 × 1.10 = 2.2629 => 2.26");
assert.ok(
  paint.quantity !== null &&
    paintNoOpenings.quantity !== null &&
    paint.quantity < paintNoOpenings.quantity,
  "subtracting openings must lower the paint quantity",
);

// A niche does NOT reduce paintable wall: it is a recess whose back and sides
// still get painted. So a niche-only room paints like a bare box.
assert.equal(
  paintTakeoff(ROOM, [opening("niche", 24, 24)], 2, PAINT).quantity,
  2.26,
  "a niche must NOT be subtracted from paintable wall",
);
assert.ok(
  hasBasisMentioning(paint.basis, "niche"),
  "and the choice is documented in the basis, not just in a comment",
);

// Coats scale the NET area, so two coats is exactly twice one coat. (The brief's
// literal formula — gross × coats − openings — would give 2.17 here, subtracting
// the window only once for a job that skips it twice. See takeoff.ts.)
const oneCoat = paintTakeoff(ROOM, OPENINGS, 1, PAINT);
assert.equal(oneCoat.quantity, 1.04, "one coat: 330.2222 ÷ 350 × 1.10 = 1.0379 => 1.04");
assert.equal(
  paint.quantity,
  1.04 * 2,
  "two coats is exactly twice one coat — openings are skipped on EVERY coat",
);
assert.notEqual(paint.quantity, 2.17, "the openings-subtracted-once formula is not what we compute");

// Waste is applied to gallons.
assert.equal(
  paintTakeoff(ROOM, OPENINGS, 2, { takeoffUnit: "gallons", defaultWasteFactor: 0 }).quantity,
  1.89,
  "no waste: 660.4444 ÷ 350 = 1.8870 => 1.89",
);

// Nonsense coat counts produce no number.
for (const coats of [0, -1, Number.NaN]) {
  const r = paintTakeoff(ROOM, OPENINGS, coats, PAINT);
  assert.equal(r.quantity, null, `coats=${String(coats)} => no quantity`);
  assert.ok(hasBasisMentioning(r.basis, "coats"), "and the basis says why");
}

// An opening missing a dimension is a GAP, not a zero — treating it as zero
// would over-order paint while looking complete.
paint = paintTakeoff(ROOM, [opening("window", 36, null)], 2, PAINT);
assert.equal(paint.quantity, null, "an opening with no height => no paint quantity");
assert.ok(hasBasisMentioning(paint.basis, "missing a width or height"), "the gap is named");

// Contradictory inputs refuse rather than return a negative or clamped area.
// 4ft × 8ft = 32 sqft of wall cannot contain a 60×80in window (33.33 sqft).
paint = paintTakeoff(
  measurement({ perimeterInches: 48, ceilingHeightInches: 96 }),
  [opening("window", 60, 80)],
  1,
  PAINT,
);
assert.equal(paint.quantity, null, "openings exceeding the wall area => no quantity");
assert.ok(hasBasisMentioning(paint.basis, "contradict"), "the contradiction is stated");

// ── Rule 5: baseboard = perimeter − door/passage widths ─────────────────────
// 480in − (32 + 36 + 48) = 364in = 30.3333 lf × 1.10 = 33.3667 => 33.37
// The window and the niche must NOT be deducted.

const BASE_OPENINGS: OpeningInput[] = [
  opening("interior_door", 32, 80),
  opening("exterior_door", 36, 80),
  opening("passage", 48, 84),
  opening("window", 36, 48),
  opening("niche", 24, 24),
];

base = baseboardTakeoff(ROOM, BASE_OPENINGS, BASE);
assert.equal(base.quantity, 33.37, "hand-computed: 33.37 linear ft");
assert.equal(base.unit, "linear_ft");
assert.equal(base.orderReady, true);

// Windows do not interrupt a baseboard run — the base passes beneath them.
assert.equal(
  baseboardTakeoff(
    ROOM,
    [opening("interior_door", 32, 80), opening("exterior_door", 36, 80), opening("passage", 48, 84)],
    BASE,
  ).quantity,
  33.37,
  "removing the window and niche changes nothing — they were never deducted",
);
assert.equal(
  baseboardTakeoff(ROOM, [opening("window", 36, 48)], BASE).quantity,
  44,
  "a window-only room deducts nothing: 40 lf × 1.10 = 44.00",
);
assert.equal(
  baseboardTakeoff(ROOM, [opening("pass_through", 36, 24)], BASE).quantity,
  44,
  "a pass-through is above the floor line and does not interrupt the base",
);
assert.ok(
  hasBasisMentioning(base.basis, "windows"),
  "and the basis documents that windows are not deducted",
);

// Doors need a width; without one the deduction is unknown, so refuse.
base = baseboardTakeoff(ROOM, [opening("interior_door", null, 80)], BASE);
assert.equal(base.quantity, null, "a door with no width => no baseboard quantity");
assert.ok(hasBasisMentioning(base.basis, "missing a width"), "the gap is named");

// Widths exceeding the perimeter contradict; do not clamp to zero.
base = baseboardTakeoff(
  measurement({ perimeterInches: 60 }),
  [opening("interior_door", 100, 80)],
  BASE,
);
assert.equal(base.quantity, null, "deductions exceeding the perimeter => no quantity");
assert.ok(hasBasisMentioning(base.basis, "contradict"), "the contradiction is stated");

// ── Rule 6: waste applies to sqft / linear_ft / gallons — NEVER to `each` ───

const DOORS: OpeningInput[] = [
  opening("interior_door", 32, 80),
  opening("interior_door", 30, 80),
  opening("exterior_door", 36, 80),
  opening("window", 36, 48),
];

let count = openingCountTakeoff(DOORS, "interior_door");
assert.equal(count.quantity, 2, "two interior doors, counted exactly — not 2.2");
assert.equal(count.unit, "each");
assert.equal(count.wasteFactor, 0, "an `each` takeoff carries NO waste — you cannot order 1.1 doors");
assert.ok(Number.isInteger(count.quantity), "a count is an integer, with nothing to round");
assert.equal(count.orderReady, true);
assert.equal(count.confidence, "known", "a count rests on the opening rows, not on a tape measure");

assert.equal(openingCountTakeoff(DOORS, "exterior_door").quantity, 1);
assert.equal(openingCountTakeoff(DOORS, "window").quantity, 1);

// Zero is a real answer, but not one to order against: an empty list is
// indistinguishable from an unsurveyed room.
count = openingCountTakeoff(DOORS, "passage");
assert.equal(count.quantity, 0, "no passages recorded => 0, not null");
assert.equal(count.orderReady, false, "a zero count is not order-ready");
assert.ok(hasBasisMentioning(count.basis, "surveyed"), "and the ambiguity is stated");
assert.equal(openingCountTakeoff([], "interior_door").quantity, 0, "an empty room counts zero");

// A material type declaring the wrong unit is refused rather than mislabelled —
// this is also what keeps a waste factor away from an `each` type.
const WRONG_UNIT = flooringTakeoff(ROOM, { takeoffUnit: "each", defaultWasteFactor: 0.5 });
assert.equal(WRONG_UNIT.quantity, null, "an `each` material type gets no sqft quantity");
assert.equal(WRONG_UNIT.wasteFactor, 0, "and no waste is reported for it");
assert.ok(hasBasisMentioning(WRONG_UNIT.basis, "refusing"), "the refusal is explained");
assert.equal(
  paintTakeoff(ROOM, OPENINGS, 2, { takeoffUnit: "sqft", defaultWasteFactor: 0.1 }).quantity,
  null,
  "paint is gallons; a sqft material type must not have gallons labelled as sqft",
);
assert.equal(
  baseboardTakeoff(ROOM, BASE_OPENINGS, { takeoffUnit: "sqft", defaultWasteFactor: 0.1 }).quantity,
  null,
  "baseboard is linear_ft; a sqft material type is refused",
);

// ── Rules 7 & 8: confidence propagates, and only "known" is order-ready ────

for (const confidence of ALL_CONFIDENCES) {
  const m = measurement({
    lengthInches: 144,
    widthInches: 120,
    ceilingHeightInches: 108,
    perimeterInches: 480,
    confidence,
  });

  const results = [
    flooringTakeoff(m, FLOORING),
    paintTakeoff(m, OPENINGS, 2, PAINT),
    baseboardTakeoff(m, BASE_OPENINGS, BASE),
  ];

  for (const r of results) {
    assert.equal(r.confidence, confidence, `confidence "${confidence}" is propagated, never upgraded`);
    assert.ok(r.quantity !== null, `an "${confidence}" measurement still yields a number`);
    assert.equal(
      r.orderReady,
      confidence === "known",
      `orderReady is true ONLY for "known" — got ${String(r.orderReady)} for "${confidence}"`,
    );
    if (confidence !== "known") {
      assert.ok(
        hasBasisMentioning(r.basis, confidence),
        `and a basis line names the "${confidence}" confidence as the reason`,
      );
      assert.ok(
        hasBasisMentioning(r.basis, "estimate"),
        "calling the number an estimate, not an order quantity",
      );
    }
  }

  // The quantities themselves do not change with confidence — an assumed
  // measurement yields the same arithmetic, labelled honestly.
  assert.equal(results[0].quantity, 132, "the number is unchanged by confidence");
  assert.equal(results[1].quantity, 2.08);
  assert.equal(results[2].quantity, 33.37);
}

// Missing inputs never produce an order-ready result, whatever the confidence.
for (const confidence of ALL_CONFIDENCES) {
  const bare = measurement({ confidence });
  for (const r of [
    flooringTakeoff(bare, FLOORING),
    paintTakeoff(bare, [], 2, PAINT),
    baseboardTakeoff(bare, [], BASE),
  ]) {
    assert.equal(r.quantity, null, "no inputs => no quantity");
    assert.equal(r.orderReady, false, "and never order-ready");
    assert.ok(r.basis.length > 0, "and always a stated reason");
  }
}

// Nothing here ever returns a bare number: every takeoff carries its basis.
for (const r of [
  flooringTakeoff(ROOM, FLOORING),
  paintTakeoff(ROOM, OPENINGS, 2, PAINT),
  baseboardTakeoff(ROOM, BASE_OPENINGS, BASE),
  openingCountTakeoff(DOORS, "interior_door"),
]) {
  assert.ok(r.basis.length > 0, "every takeoff reports its inputs");
  assert.ok(
    typeof r.orderReady === "boolean" && typeof r.unit === "string",
    "every takeoff is a Takeoff, not a number",
  );
}

console.log("0043 §5c takeoff calculators: all assertions passed");
