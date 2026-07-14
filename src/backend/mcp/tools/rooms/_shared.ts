import { rooms } from "@backend/db";

/** Shape a room row for tool output (dimensions folded into a readable string). */
export function roomDto(r: typeof rooms.$inferSelect) {
  const dim =
    r.lengthFeet != null && r.widthFeet != null
      ? `${r.lengthFeet}'${r.lengthInches ?? 0}" x ${r.widthFeet}'${r.widthInches ?? 0}"`
      : null;
  return {
    id: r.id,
    roomCode: r.roomCode,
    roomName: r.roomName,
    floorId: r.floorId,
    asIsUse: r.asIsUse,
    dimensions: dim,
    areaSqFt: r.areaSqFt,
    isLivingSpace: r.isLivingSpace,
  };
}
