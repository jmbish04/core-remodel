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
  return {
    id: r.id,
    roomCode: r.roomCode,
    roomName: r.roomName,
    floorId: r.floorId,
    floorName,
    asIsUse: r.asIsUse,
    dimensions: dim,
    areaSqFt: r.areaSqFt,
    isLivingSpace: r.isLivingSpace,
  };
}
