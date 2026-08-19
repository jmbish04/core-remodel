/**
 * The room stop ladder and its one invariant (0041 Phase 0).
 *
 * THE STOP IS HIGH-WATER. It records the furthest point a room has ever reached
 * and it never retreats. When something upstream invalidates a settled decision,
 * the room keeps its stop and the reopening is recorded separately — so the
 * diagram renders "still at FINISH_SPEC, with 3 decisions reopened" instead of
 * sliding the marker back to SOURCING.
 *
 * Sliding it back is the exact visual that makes a homeowner feel they lost two
 * months, and it is where real projects and real partnerships break. That is why
 * this is a guarded function and not a bare UPDATE.
 */

export const ROOM_STOPS = [
  "SOURCING",
  "FIXTURES_LOCKED",
  "ROUGH_IN",
  "FINISH_SPEC",
  "SIGNED_OFF",
] as const;

export type RoomStop = (typeof ROOM_STOPS)[number];

export function isRoomStop(value: string): value is RoomStop {
  return (ROOM_STOPS as readonly string[]).includes(value);
}

/** Ordinal position on the ladder. -1 for an unknown value. */
export function stopRank(stop: string): number {
  return (ROOM_STOPS as readonly string[]).indexOf(stop);
}

export type StopAdvanceVerdict =
  | { ok: true; from: RoomStop | null; to: RoomStop }
  | { ok: false; reason: string; from: RoomStop | null; to: string };

/**
 * Decide whether a room may move to `next`.
 *
 * Allowed: any strictly forward move, including skipping a stop — a room that
 * genuinely arrives at FINISH_SPEC without a separate ROUGH_IN event is real.
 *
 * Refused: staying put, and every backward move. A caller that wants to express
 * "this is no longer true" reopens a decision; it does not lower the stop.
 */
export function canAdvanceStop(current: string | null, next: string): StopAdvanceVerdict {
  if (!isRoomStop(next)) {
    return { ok: false, reason: `"${next}" is not a room stop`, from: null, to: next };
  }
  if (current === null) {
    return { ok: true, from: null, to: next };
  }
  if (!isRoomStop(current)) {
    return { ok: false, reason: `current stop "${current}" is not a room stop`, from: null, to: next };
  }
  const from = stopRank(current);
  const to = stopRank(next);
  if (to === from) {
    return { ok: false, reason: `already at ${current}`, from: current, to: next };
  }
  if (to < from) {
    return {
      ok: false,
      // Named explicitly so this shows up verbatim in logs and in review.
      reason:
        `refusing to lower the stop from ${current} to ${next}: ` +
        "the stop is high-water. Reopen a decision instead.",
      from: current,
      to: next,
    };
  }
  return { ok: true, from: current, to: next };
}
