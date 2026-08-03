/**
 * Shared primitives for the room-geometry calculators.
 *
 * Every geometry value (area, linear feet, …) is DERIVED from a room/element's
 * stored feet + inches on the fly — 0043 removed the stored `rooms.area_sq_ft`
 * column because a cached calculation goes stale the moment a dimension changes.
 * Keeping the primitives here means every calculator agrees on how a dimension
 * becomes a number — one definition, no per-caller drift.
 */

/** A room or element's raw feet + inches dimensions — the input to every calc. */
export interface Dimensions {
  lengthFeet: number | null;
  lengthInches: number | null;
  widthFeet: number | null;
  widthInches: number | null;
}

/** feet + inches → decimal feet. Returns null when both sides are absent. */
export function toFeet(feet: number | null, inches: number | null): number | null {
  if (feet == null && inches == null) return null;
  return (feet ?? 0) + (inches ?? 0) / 12;
}

/** Round to 2 decimal places (the precision every geometry calc reports in). */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
