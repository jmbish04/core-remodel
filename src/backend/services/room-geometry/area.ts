/**
 * Area calculators — square footage derived from dimensions.
 *
 * Any authoritative override for an irregular footprint lives in
 * `room_measurements.area_sq_ft_override`, never on the room (0043).
 */
import { type Dimensions, round2, toFeet } from "./dimensions";

/** Rectangular area of a room = length × width, in square feet. Null when either
 * dimension is missing (never a guessed default). */
export function computeRoomAreaSqFt(r: Dimensions): number | null {
  const lengthFt = toFeet(r.lengthFeet, r.lengthInches);
  const widthFt = toFeet(r.widthFeet, r.widthInches);
  return lengthFt != null && widthFt != null ? round2(lengthFt * widthFt) : null;
}

/** Total square footage across many rooms (e.g. every room on a floor, or the
 * whole home). Rooms with unknown dimensions contribute 0. */
export function sumRoomAreaSqFt(rooms: Dimensions[]): number {
  return round2(rooms.reduce((sum, r) => sum + (computeRoomAreaSqFt(r) ?? 0), 0));
}
