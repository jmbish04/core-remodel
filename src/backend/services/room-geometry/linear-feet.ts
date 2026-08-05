/**
 * Linear-feet calculators — the running length of a wall, a room's perimeter,
 * or the total across a floor / the whole home.
 *
 * Scopes:
 *  - a single wall/segment  → `segmentLinearFt(feet, inches)`
 *  - an entire room         → `computeRoomLinearFt(room)`  (rectangular perimeter)
 *  - a floor / the home     → `sumRoomLinearFt(rooms[])`
 *
 * NOTE: the room/floor figures here are the RECTANGULAR estimate from stored
 * dimensions — correct for a rectangular room and the only signal available
 * without a wall graph. Once the 0043 `walls` table lands, a walls-driven
 * perimeter (which handles L-shaped / non-rectangular rooms) supersedes it; see
 * the measurement view's `perimeterSource` precedence (walls > measured >
 * rectangular_estimate).
 */
import { type Dimensions, round2, toFeet } from "./dimensions";

/** Linear feet of one wall / straight run, from its feet + inches length.
 * Null when no length is given. */
export function segmentLinearFt(feet: number | null, inches: number | null): number | null {
  const ft = toFeet(feet, inches);
  return ft != null ? round2(ft) : null;
}

/** Rectangular perimeter of a room = 2 × (length + width), in linear feet.
 * Null when either dimension is missing. */
export function computeRoomLinearFt(r: Dimensions): number | null {
  const lengthFt = toFeet(r.lengthFeet, r.lengthInches);
  const widthFt = toFeet(r.widthFeet, r.widthInches);
  return lengthFt != null && widthFt != null ? round2(2 * (lengthFt + widthFt)) : null;
}

/** Total linear feet (summed rectangular perimeters) across many rooms — a
 * floor's rooms, or every active room in the home. Rooms with unknown
 * dimensions contribute 0. */
export function sumRoomLinearFt(rooms: Dimensions[]): number {
  return round2(rooms.reduce((sum, r) => sum + (computeRoomLinearFt(r) ?? 0), 0));
}
