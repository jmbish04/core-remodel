/**
 * The canonical measurement view (0043).
 *
 * ONE SHAPE FOR EVERY ROOM, ALWAYS. A measurement read returns the same object
 * whether the room is a plain rectangle or a scanned L-shape, whether it has an
 * override or not, whether it has walls or not. Every field is always present;
 * absent data is `null`, never a missing key.
 *
 * WHY: full transparency and no IFTTT at the call site. The consumer never has
 * to know "if there is an override, read that, else compute" — it receives BOTH
 * the computed rectangle AND the override AND the reasoning behind the override,
 * and can show all three ("computed 132, actual 128 — L-shaped, measured"). The
 * `effective*` fields say which value to use, but the raw inputs are never
 * hidden. No branching logic leaks into every caller.
 *
 * Pure — takes the measurement row and the room's walls, returns the view. No
 * database, so it is testable and can run against proposed values.
 */

export interface MeasurementRowInput {
  lengthInches: number | null;
  widthInches: number | null;
  ceilingHeightInches: number | null;
  perimeterInches: number | null;
  areaSqFtOverride: number | null;
  areaSqFtOverrideNotes: string | null;
  areaSqFtOverrideCalculation: string | null;
  confidence: string | null;
}

export interface WallRecord {
  id: number;
  label: string | null;
  lengthInches: number | null;
  heightInches: number | null;
  wallKind: string;
  loadBearing: string;
}

export interface MeasurementView {
  /** Every wall bounding this room. Always an array — empty, never null. */
  walls: WallRecord[];

  /** Rectangular area from length × width ÷ 144. Null when a dimension is missing. */
  computeAreaSqFt: number | null;

  /** Measured area for an irregular footprint. Null when the room is a rectangle. */
  areaSqFtOverride: number | null;
  /** Why the override exists. Null when there is no override. */
  areaSqFtOverrideNotes: string | null;
  /** How the override was arrived at. Null when there is no override. */
  areaSqFtOverrideCalculation: string | null;

  /**
   * Perimeter in linear feet. From the sum of wall lengths when walls exist
   * (correct for ANY shape); else the measured `perimeterInches`; else the
   * rectangular estimate 2 × (L + W). `perimeterSource` says which, so the number
   * is never anonymous.
   */
  computeLinearFt: number | null;
  perimeterSource: "walls" | "measured" | "rectangular_estimate" | "unavailable";

  /** Ceiling height in feet, computed from inches. */
  ceilingHeightFt: number | null;

  /**
   * The area a consumer should USE: the override when present, else the computed
   * rectangle. Both raw inputs remain above; this is a convenience, not a hiding
   * place.
   */
  effectiveAreaSqFt: number | null;
  effectiveAreaSource: "override" | "computed" | "unavailable";

  /** The confidence of the underlying measurement, propagated not upgraded. */
  confidence: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function measurementView(
  m: MeasurementRowInput | null,
  walls: WallRecord[],
): MeasurementView {
  const row: MeasurementRowInput = m ?? {
    lengthInches: null,
    widthInches: null,
    ceilingHeightInches: null,
    perimeterInches: null,
    areaSqFtOverride: null,
    areaSqFtOverrideNotes: null,
    areaSqFtOverrideCalculation: null,
    confidence: null,
  };

  // Rectangular area — computed, never stored.
  const computeAreaSqFt =
    row.lengthInches != null && row.widthInches != null
      ? round2((row.lengthInches * row.widthInches) / 144)
      : null;

  // Perimeter: walls are correct for any shape; then a measured perimeter; then
  // the rectangular estimate. The source is always reported.
  const wallSumInches = walls.reduce(
    (sum, w) => (w.lengthInches != null ? sum + w.lengthInches : sum),
    0,
  );
  const hasWallLengths = walls.some((w) => w.lengthInches != null);

  let computeLinearFt: number | null = null;
  let perimeterSource: MeasurementView["perimeterSource"] = "unavailable";
  if (hasWallLengths) {
    computeLinearFt = round2(wallSumInches / 12);
    perimeterSource = "walls";
  } else if (row.perimeterInches != null) {
    computeLinearFt = round2(row.perimeterInches / 12);
    perimeterSource = "measured";
  } else if (row.lengthInches != null && row.widthInches != null) {
    computeLinearFt = round2((2 * (row.lengthInches + row.widthInches)) / 12);
    perimeterSource = "rectangular_estimate";
  }

  const ceilingHeightFt =
    row.ceilingHeightInches != null ? round2(row.ceilingHeightInches / 12) : null;

  // Effective area: override wins, else computed. Both remain visible above.
  let effectiveAreaSqFt: number | null;
  let effectiveAreaSource: MeasurementView["effectiveAreaSource"];
  if (row.areaSqFtOverride != null) {
    effectiveAreaSqFt = row.areaSqFtOverride;
    effectiveAreaSource = "override";
  } else if (computeAreaSqFt != null) {
    effectiveAreaSqFt = computeAreaSqFt;
    effectiveAreaSource = "computed";
  } else {
    effectiveAreaSqFt = null;
    effectiveAreaSource = "unavailable";
  }

  return {
    walls,
    computeAreaSqFt,
    areaSqFtOverride: row.areaSqFtOverride,
    areaSqFtOverrideNotes: row.areaSqFtOverrideNotes,
    areaSqFtOverrideCalculation: row.areaSqFtOverrideCalculation,
    computeLinearFt,
    perimeterSource,
    ceilingHeightFt,
    effectiveAreaSqFt,
    effectiveAreaSource,
    confidence: row.confidence,
  };
}
