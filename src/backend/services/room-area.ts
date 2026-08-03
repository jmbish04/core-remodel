/**
 * Compute a room's square footage from its stored dimensions.
 *
 * 0043 removed the stored `rooms.area_sq_ft` column — a cached calculation goes
 * stale the moment a dimension changes — so area is DERIVED on the fly, the same
 * way for every room, with no per-caller special logic. Any authoritative
 * override lives in `room_measurements.area_sq_ft_override`, not on the room.
 *
 * Returns null when either dimension is missing (never a guessed default).
 */
export function computeRoomAreaSqFt(r: {
  lengthFeet: number | null;
  lengthInches: number | null;
  widthFeet: number | null;
  widthInches: number | null;
}): number | null {
  const lengthFt =
    r.lengthFeet != null || r.lengthInches != null
      ? (r.lengthFeet ?? 0) + (r.lengthInches ?? 0) / 12
      : null;
  const widthFt =
    r.widthFeet != null || r.widthInches != null
      ? (r.widthFeet ?? 0) + (r.widthInches ?? 0) / 12
      : null;
  return lengthFt != null && widthFt != null
    ? Math.round(lengthFt * widthFt * 100) / 100
    : null;
}
