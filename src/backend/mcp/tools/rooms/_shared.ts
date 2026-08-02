import { rooms } from "@backend/db";

/**
 * Shape a room row for tool output (dimensions folded into a readable string).
 *
 * `floorName` is DERIVED — joined from `floors` by the caller and passed in.
 * There is no denormalized floor-name column (AGENTS.md "Foreign keys, never
 * denormalized name columns"). It matters for deduction: "Upper Level" vs
 * "Lower Level" is what separates the upstairs hall bath from the downstairs
 * guest bath.
 */
export function roomDto(r: typeof rooms.$inferSelect, floorName: string | null) {
  const dim =
    r.lengthFeet != null && r.widthFeet != null
      ? `${r.lengthFeet}'${r.lengthInches ?? 0}" x ${r.widthFeet}'${r.widthInches ?? 0}"`
      : null;
  // Area is COMPUTED from the dimensions, never a stored column (0043 removed
  // rooms.area_sq_ft — a stored calculation goes stale when a dimension changes).
  const lengthFt =
    r.lengthFeet != null || r.lengthInches != null
      ? (r.lengthFeet ?? 0) + (r.lengthInches ?? 0) / 12
      : null;
  const widthFt =
    r.widthFeet != null || r.widthInches != null
      ? (r.widthFeet ?? 0) + (r.widthInches ?? 0) / 12
      : null;
  const areaSqFt =
    lengthFt != null && widthFt != null ? Math.round(lengthFt * widthFt * 100) / 100 : null;
  return {
    id: r.id,
    roomCode: r.roomCode,
    roomName: r.roomName,
    floorId: r.floorId,
    floorName,
    asIsUse: r.asIsUse,
    dimensions: dim,
    areaSqFt,
    isLivingSpace: r.isLivingSpace,
  };
}
