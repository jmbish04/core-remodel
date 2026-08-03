/**
 * takeoff — the quantity calculators for 0043 §5c.
 *
 * PURE ARITHMETIC. There is deliberately no D1 in this file, and no schema
 * import: the caller fetches the rows and passes their shapes in. Same reason
 * `evaluateRoomReadiness` is separated from `roomReadiness` — the rules below are
 * load-bearing enough to be testable without a database, and the same functions
 * have to run against *proposed* (uncommitted) measurements in a cost-of-change
 * preview, where no row exists yet.
 *
 * TAKEOFFS ARE COMPUTED ON READ AND NEVER STORED. A stored quantity is wrong the
 * first time a wall moves, and nobody notices. Nothing here writes anything.
 *
 * Every function returns a `Takeoff`, never a bare number, because a quantity
 * without its basis is a number a homeowner will act on without knowing what it
 * rests on. A figure derived from an `assumed` measurement is an estimate with
 * its arithmetic shown; it is not a quantity to order from, and `orderReady`
 * says so out loud.
 */

export type MeasurementConfidence = "known" | "assumed" | "range" | "unknown";

export type TakeoffUnit = "sqft" | "linear_ft" | "each" | "gallons";

export type OpeningKind =
  | "window"
  | "exterior_door"
  | "interior_door"
  | "passage"
  | "niche"
  | "pass_through";

export interface MeasurementInput {
  lengthInches: number | null;
  widthInches: number | null;
  ceilingHeightInches: number | null;
  perimeterInches: number | null;
  /** Authoritative area for irregular rooms; wins over length × width. */
  areaSqFtOverride: number | null;
  confidence: MeasurementConfidence;
}

export interface OpeningInput {
  openingKind: OpeningKind;
  widthInches: number | null;
  heightInches: number | null;
}

export interface MaterialTypeInput {
  takeoffUnit: TakeoffUnit;
  /** e.g. 0.10 for plank flooring, 0.15 for a diagonal tile lay. */
  defaultWasteFactor: number;
}

export interface Takeoff {
  /** null when it cannot be computed. Never a guess. */
  quantity: number | null;
  unit: TakeoffUnit;
  wasteFactor: number;
  confidence: MeasurementConfidence;
  /** Human-readable list of what went into this number, and any gaps. */
  basis: string[];
  /** True only when every input was present and confidence is "known". */
  orderReady: boolean;
}

/**
 * Paint coverage. One gallon of interior wall paint covers roughly 350 square
 * feet of primed drywall at one coat — the mid-point of the 300–400 range every
 * manufacturer prints on the can. It is an assumption, not a measurement, which
 * is why it lives here as one named constant instead of being buried in the
 * arithmetic: when a product sheet says otherwise, this is the single line to
 * change, and every basis string reports the value actually used.
 */
export const PAINT_COVERAGE_SQFT_PER_GALLON = 350;

const SQ_INCHES_PER_SQ_FOOT = 144;
const INCHES_PER_FOOT = 12;

/**
 * Openings that reduce paintable wall area.
 *
 * A niche is EXCLUDED on purpose: it is a recess *into* the wall, not a hole
 * through it, and its back and sides still get painted — subtracting it would
 * under-order. `pass_through` is also excluded, and that is the one call here we
 * are least sure of; see the note on `paintTakeoff`.
 */
const PAINT_SUBTRACTING_KINDS: readonly OpeningKind[] = [
  "window",
  "exterior_door",
  "interior_door",
  "passage",
];

/**
 * Openings that interrupt a baseboard run.
 *
 * Only things you walk through. Windows are EXCLUDED because baseboard runs
 * unbroken beneath them; so is a niche (a recess above the floor line) and a
 * pass-through (an opening at counter height). Anything that does not meet the
 * floor does not interrupt the base.
 */
const BASEBOARD_INTERRUPTING_KINDS: readonly OpeningKind[] = [
  "exterior_door",
  "interior_door",
  "passage",
];

/**
 * A dimension is usable only when it is a finite, positive number. `null`, NaN,
 * zero and negatives are all the same thing here — an absent measurement — and
 * they must produce a gap rather than a zero that silently propagates into a
 * quantity. A room with zero length does not exist.
 */
function measured(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

/** Display precision. Rounded once, at the end, never mid-calculation. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function f2(value: number): string {
  return value.toFixed(2);
}

/**
 * A waste factor must be a finite number ≥ 0. Anything else is a data fault, and
 * the honest response is to apply no waste and say we ignored it — never to
 * multiply a quantity by NaN, which yields a number-shaped non-number.
 */
function resolveWasteFactor(raw: number, basis: string[]): number {
  if (!Number.isFinite(raw) || raw < 0) {
    basis.push(
      `waste factor ${String(raw)} is not a usable factor — ignored, no waste applied`,
    );
    return 0;
  }
  return raw;
}

interface OpeningTally {
  sqft: number;
  inches: number;
  summary: string;
  /** Kinds that should have counted but were missing a dimension. */
  incomplete: OpeningKind[];
}

/** Sum the area AND the width of every opening of the given kinds. */
function tallyOpenings(
  openings: OpeningInput[],
  kinds: readonly OpeningKind[],
  needHeight: boolean,
): OpeningTally {
  let sqft = 0;
  let inches = 0;
  const counts = new Map<OpeningKind, number>();
  const incomplete: OpeningKind[] = [];

  for (const opening of openings) {
    if (!kinds.includes(opening.openingKind)) continue;

    const width = measured(opening.widthInches);
    const height = measured(opening.heightInches);

    // An opening with no dimensions cannot be subtracted. Treating it as zero
    // would over-report the surface, so it is recorded as a gap instead and the
    // caller refuses to return a number at all.
    if (width === null || (needHeight && height === null)) {
      incomplete.push(opening.openingKind);
      continue;
    }

    inches += width;
    if (height !== null) sqft += (width * height) / SQ_INCHES_PER_SQ_FOOT;
    counts.set(opening.openingKind, (counts.get(opening.openingKind) ?? 0) + 1);
  }

  const summary = [...counts.entries()].map(([kind, n]) => `${n} ${kind}`).join(", ");
  return { sqft, inches, summary, incomplete };
}

/**
 * Build the result. `orderReady` is decided in exactly one place so no caller can
 * accidentally promote an estimate: a number you can order from requires every
 * input present AND a measurement someone actually took.
 */
function finish(args: {
  quantity: number | null;
  unit: TakeoffUnit;
  wasteFactor: number;
  confidence: MeasurementConfidence;
  basis: string[];
}): Takeoff {
  const orderReady = args.quantity !== null && args.confidence === "known";
  if (args.quantity !== null && args.confidence !== "known") {
    args.basis.push(
      `measurement confidence is "${args.confidence}" — this is an estimate with its basis shown, not a quantity to order from`,
    );
  }
  return { ...args, orderReady };
}

/** The gap case: no number, and the reason stated. */
function unavailable(
  unit: TakeoffUnit,
  confidence: MeasurementConfidence,
  basis: string[],
): Takeoff {
  return {
    quantity: null,
    unit,
    wasteFactor: 0,
    confidence,
    basis,
    orderReady: false,
  };
}

/**
 * A material type declaring the wrong unit is a data fault, and the resulting
 * harm is specific: labelling gallons of paint as "sqft" hands someone a number
 * they will act on in the wrong dimension. Refuse rather than mislabel.
 */
function unitMismatch(expected: TakeoffUnit, mt: MaterialTypeInput): string | null {
  if (mt.takeoffUnit === expected) return null;
  return `material type declares unit "${mt.takeoffUnit}" but this is a ${expected} takeoff — refusing to label a ${expected} quantity as "${mt.takeoffUnit}"`;
}

/**
 * Floor area in square FEET.
 *
 * `areaSqFtOverride` wins over length × width and says so, because rooms are not
 * rectangles — the L-shaped lower foyer is 77.28 sq ft and no length × width
 * produces that. When the override is absent we fall back to length × width and
 * name THAT as the basis, so a reader can tell which of the two they are
 * looking at.
 */
function floorAreaRaw(m: MeasurementInput): { sqft: number | null; basis: string[] } {
  const basis: string[] = [];
  const override = measured(m.areaSqFtOverride);

  if (override !== null) {
    basis.push(`area override ${f2(override)} sqft (authoritative — irregular room)`);
    const length = measured(m.lengthInches);
    const width = measured(m.widthInches);
    if (length !== null && width !== null) {
      basis.push(
        `length × width (${f2(length)} × ${f2(width)} in) present but NOT used — the override wins`,
      );
    }
    return { sqft: override, basis };
  }

  const length = measured(m.lengthInches);
  const width = measured(m.widthInches);
  if (length === null || width === null) {
    basis.push(
      `no area: areaSqFtOverride is absent and ${length === null ? "lengthInches" : "widthInches"} is missing`,
    );
    return { sqft: null, basis };
  }

  const sqft = (length * width) / SQ_INCHES_PER_SQ_FOOT;
  basis.push(
    `length × width = ${f2(length)} × ${f2(width)} in = ${f2(sqft)} sqft (no area override — rectangular assumption)`,
  );
  return { sqft, basis };
}

export function floorAreaSqFt(m: MeasurementInput): { sqft: number | null; basis: string[] } {
  const { sqft, basis } = floorAreaRaw(m);
  return { sqft: sqft === null ? null : round2(sqft), basis };
}

/** Flooring: floor area × (1 + waste), in square feet. */
export function flooringTakeoff(m: MeasurementInput, mt: MaterialTypeInput): Takeoff {
  const basis: string[] = [];

  const mismatch = unitMismatch("sqft", mt);
  if (mismatch !== null) {
    basis.push(mismatch);
    return unavailable(mt.takeoffUnit, m.confidence, basis);
  }

  const area = floorAreaRaw(m);
  basis.push(...area.basis);
  if (area.sqft === null) {
    return unavailable("sqft", m.confidence, basis);
  }

  const waste = resolveWasteFactor(mt.defaultWasteFactor, basis);
  const quantity = area.sqft * (1 + waste);
  basis.push(`waste factor ${f2(waste)} applied → ${f2(quantity)} sqft`);

  return finish({
    quantity: round2(quantity),
    unit: "sqft",
    wasteFactor: waste,
    confidence: m.confidence,
    basis,
  });
}

/**
 * Paint, in gallons.
 *
 *   (perimeter × ceiling height − opening area) × coats ÷ coverage × (1 + waste)
 *
 * PERIMETER IS REQUIRED AND IS NOT DERIVABLE. Two rooms of identical area have
 * wildly different perimeters, so there is no honest way to reach a wall area
 * from an area override. Missing perimeter returns `null`, not a guess.
 *
 * DEVIATION FROM THE BRIEF, DELIBERATE: the brief states the formula as
 * "perimeter × ceiling height × coats − opening area", which subtracts the
 * openings ONCE no matter how many coats are applied. That over-orders by
 * `openingArea × (coats − 1) ÷ coverage` — you skip the window on every coat,
 * not just the first. We multiply the NET wall area by coats instead, so that
 * two coats is exactly twice one coat. Flagged rather than silently followed.
 */
export function paintTakeoff(
  m: MeasurementInput,
  openings: OpeningInput[],
  coats: number,
  mt: MaterialTypeInput,
): Takeoff {
  const basis: string[] = [];

  const mismatch = unitMismatch("gallons", mt);
  if (mismatch !== null) {
    basis.push(mismatch);
    return unavailable(mt.takeoffUnit, m.confidence, basis);
  }

  const perimeter = measured(m.perimeterInches);
  const height = measured(m.ceilingHeightInches);

  if (perimeter === null) {
    basis.push(
      "no paint quantity: perimeterInches is missing, and perimeter CANNOT be derived from area — two rooms of equal area have different perimeters. Measure the perimeter.",
    );
  }
  if (height === null) {
    basis.push("no paint quantity: ceilingHeightInches is missing");
  }
  if (!Number.isFinite(coats) || coats <= 0) {
    basis.push(`no paint quantity: coats must be a positive number, got ${String(coats)}`);
  }
  if (perimeter === null || height === null || !Number.isFinite(coats) || coats <= 0) {
    return unavailable("gallons", m.confidence, basis);
  }

  const perimeterFt = perimeter / INCHES_PER_FOOT;
  const heightFt = height / INCHES_PER_FOOT;
  const grossSqFt = perimeterFt * heightFt;
  basis.push(
    `perimeter ${f2(perimeter)} in = ${f2(perimeterFt)} linear ft × ceiling ${f2(height)} in = ${f2(heightFt)} ft → ${f2(grossSqFt)} sqft gross wall`,
  );

  const tally = tallyOpenings(openings, PAINT_SUBTRACTING_KINDS, true);
  if (tally.incomplete.length > 0) {
    basis.push(
      `no paint quantity: ${tally.incomplete.length} opening(s) (${tally.incomplete.join(", ")}) are missing a width or height, so the area to subtract is unknown — treating them as zero would over-order`,
    );
    return unavailable("gallons", m.confidence, basis);
  }

  basis.push(
    tally.summary === ""
      ? "no openings subtracted (none recorded of a kind that reduces paintable wall)"
      : `openings subtracted: ${tally.summary} = ${f2(tally.sqft)} sqft`,
  );
  basis.push(
    "niche and pass_through are NOT subtracted — a niche is a recess whose back and sides still get painted",
  );

  const netSqFt = grossSqFt - tally.sqft;
  if (netSqFt <= 0) {
    basis.push(
      `no paint quantity: opening area (${f2(tally.sqft)} sqft) meets or exceeds the gross wall area (${f2(grossSqFt)} sqft) — the inputs contradict each other`,
    );
    return unavailable("gallons", m.confidence, basis);
  }

  const paintedSqFt = netSqFt * coats;
  basis.push(
    `net paintable ${f2(netSqFt)} sqft × ${coats} coat(s) = ${f2(paintedSqFt)} sqft painted`,
  );

  const gallonsBare = paintedSqFt / PAINT_COVERAGE_SQFT_PER_GALLON;
  basis.push(
    `÷ ${PAINT_COVERAGE_SQFT_PER_GALLON} sqft/gallon coverage = ${f2(gallonsBare)} gal`,
  );

  const waste = resolveWasteFactor(mt.defaultWasteFactor, basis);
  const quantity = gallonsBare * (1 + waste);
  basis.push(`waste factor ${f2(waste)} applied → ${f2(quantity)} gal`);
  basis.push(
    "gallons are NOT rounded up to whole containers — how many cans to buy is a purchasing decision, not a takeoff",
  );

  return finish({
    quantity: round2(quantity),
    unit: "gallons",
    wasteFactor: waste,
    confidence: m.confidence,
    basis,
  });
}

/**
 * Baseboard, in linear feet.
 *
 *   (perimeter − door/passage widths) ÷ 12 × (1 + waste)
 *
 * WINDOWS DO NOT REDUCE BASEBOARD. The base runs unbroken beneath a window; only
 * an opening you walk through interrupts it. Neither does a niche or a
 * pass-through, for the same reason — they do not meet the floor.
 *
 * Perimeter is required and cannot be derived from area, exactly as for paint.
 */
export function baseboardTakeoff(
  m: MeasurementInput,
  openings: OpeningInput[],
  mt: MaterialTypeInput,
): Takeoff {
  const basis: string[] = [];

  const mismatch = unitMismatch("linear_ft", mt);
  if (mismatch !== null) {
    basis.push(mismatch);
    return unavailable(mt.takeoffUnit, m.confidence, basis);
  }

  const perimeter = measured(m.perimeterInches);
  if (perimeter === null) {
    basis.push(
      "no baseboard quantity: perimeterInches is missing, and perimeter CANNOT be derived from area — measure it. A guessed run is worse than no number.",
    );
    return unavailable("linear_ft", m.confidence, basis);
  }

  // Height is irrelevant to a baseboard run, so it is not required here.
  const tally = tallyOpenings(openings, BASEBOARD_INTERRUPTING_KINDS, false);
  if (tally.incomplete.length > 0) {
    basis.push(
      `no baseboard quantity: ${tally.incomplete.length} door/passage opening(s) (${tally.incomplete.join(", ")}) are missing a width, so the run to deduct is unknown`,
    );
    return unavailable("linear_ft", m.confidence, basis);
  }

  basis.push(`perimeter ${f2(perimeter)} in`);
  basis.push(
    tally.summary === ""
      ? "no openings deducted (no doors or passages recorded)"
      : `door/passage widths deducted: ${tally.summary} = ${f2(tally.inches)} in`,
  );
  basis.push(
    "windows, niches and pass-throughs are NOT deducted — baseboard runs beneath them",
  );

  const netInches = perimeter - tally.inches;
  if (netInches <= 0) {
    basis.push(
      `no baseboard quantity: door/passage widths (${f2(tally.inches)} in) meet or exceed the perimeter (${f2(perimeter)} in) — the inputs contradict each other`,
    );
    return unavailable("linear_ft", m.confidence, basis);
  }

  const netFt = netInches / INCHES_PER_FOOT;
  basis.push(`net run ${f2(netInches)} in = ${f2(netFt)} linear ft`);

  const waste = resolveWasteFactor(mt.defaultWasteFactor, basis);
  const quantity = netFt * (1 + waste);
  basis.push(`waste factor ${f2(waste)} applied → ${f2(quantity)} linear ft`);

  return finish({
    quantity: round2(quantity),
    unit: "linear_ft",
    wasteFactor: waste,
    confidence: m.confidence,
    basis,
  });
}

/**
 * Count of openings of one kind — doors, windows, passages.
 *
 * NO WASTE, EVER. You cannot order 1.1 doors, so an `each` takeoff ignores waste
 * entirely and reports `wasteFactor: 0`. Counts are integers already; there is
 * nothing to round.
 *
 * `confidence` is "known" rather than a measurement's confidence because there is
 * no measurement involved: the number rests on the enumerated opening rows, not
 * on anyone's tape. It takes no `MaterialTypeInput` for the same reason — there
 * is no unit or waste to inherit.
 *
 * A count of ZERO reports `orderReady: false`. An empty openings list is
 * indistinguishable from a room nobody has surveyed yet, and "order zero doors"
 * is not a decision worth signing off on either way.
 */
export function openingCountTakeoff(openings: OpeningInput[], kind: OpeningKind): Takeoff {
  const matching = openings.filter((o) => o.openingKind === kind);
  const basis: string[] = [
    `counted ${matching.length} opening(s) of kind "${kind}" out of ${openings.length} recorded`,
    "counts carry no waste factor — you cannot order 1.1 doors",
  ];

  if (matching.length === 0) {
    basis.push(
      `no "${kind}" openings recorded — this may mean none exist, or that the room has not been surveyed yet. The two are indistinguishable from here.`,
    );
  }

  return {
    quantity: matching.length,
    unit: "each",
    wasteFactor: 0,
    confidence: "known",
    basis,
    orderReady: matching.length > 0,
  };
}
