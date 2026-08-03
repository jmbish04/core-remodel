import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { rooms } from "../../db/schema";

/**
 * resolveRoomScope — the one place a "whole floor" or "whole house" selection
 * becomes a set of per-room rows (0043 Phase 0, plan §5b).
 *
 * THE UI OFFERS THE SHORTCUT, THE API RESOLVES IT, THE DATABASE STORES PER-ROOM
 * ROWS. A homeowner ticks "entire Upper Level"; this turns that into the 23
 * active rooms on that floor, and every consumer downstream keeps joining
 * `WHERE room_id = ?` with no awareness a floor was ever involved.
 *
 * An earlier design put a fake `all_levels` floor in the data. That was rejected:
 * a shortcut in the data is one every query must then know about forever, and the
 * first consumer that forgets it returns a wrong answer silently.
 *
 * The intent of the selection — "this was the whole upper floor" — is not lost;
 * it is recorded separately in `room_scope_applications` (a later task) so a room
 * added to the floor afterwards can be offered what it is missing. This module
 * only resolves the set; it does not write the mapping rows.
 */

export type RoomScope = "room" | "rooms" | "floor" | "project";

export interface ScopeRequest {
  scope: RoomScope;
  /** Floor id when scope = "floor". Ignored otherwise. */
  scopeRefId?: number | null;
  /** Explicit room ids when scope = "room" | "rooms". */
  roomIds?: number[];
}

export interface RoomRow {
  id: number;
  floorId: number;
  isActive: boolean;
}

export interface ScopeResolution {
  /** The resolved set, active-only, de-duplicated, sorted ascending by id. */
  roomIds: number[];
  scope: RoomScope;
  scopeRefId: number | null;
  /** What was asked for but not included, and why — never silently dropped. */
  skipped: {
    /** Requested ids that are not active rooms (merged / deactivated). */
    inactive: number[];
    /** Requested ids that do not exist at all. */
    unknown: number[];
  };
}

export class ScopeError extends Error {}

/**
 * Split a list into chunks. Default 20.
 *
 * D1 rejects any single statement with more than 100 bound values. Fanning a
 * material out onto 23 rooms × several columns blows that cap in one insert, and
 * this is a fan-out feature BY DESIGN — so the writer that consumes a resolution
 * must chunk. Exported here so it, and every caller, uses the same size.
 */
export function chunk<T>(values: T[], size = 20): T[][] {
  if (size < 1) throw new ScopeError(`chunk size must be >= 1, got ${size}`);
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/** Deterministic, de-duplicated, ascending. */
function normalise(ids: number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * The pure resolution. No database — takes the candidate rooms, returns the set.
 *
 * Kept pure so the rules below can be tested directly, and so the same logic can
 * run against an in-memory room list in a preview before anything is written.
 */
export function resolveScope(request: ScopeRequest, allRooms: RoomRow[]): ScopeResolution {
  const active = new Map<number, RoomRow>();
  const known = new Set<number>();
  for (const r of allRooms) {
    known.add(r.id);
    if (r.isActive) active.set(r.id, r);
  }

  const base: Pick<ScopeResolution, "scope" | "scopeRefId"> = {
    scope: request.scope,
    scopeRefId: request.scopeRefId ?? null,
  };

  switch (request.scope) {
    case "project": {
      // Every active room = the whole house. This is a SINGLE-HOME app: rooms
      // belong to floors, floors to the one house — there is no rooms.project_id
      // and no cross-tenant partition, so "project" scope is deliberately "all
      // rooms", not a per-project filter. If the model ever becomes multi-project,
      // add rooms.project_id and filter both here and in resolveRoomScope's query.
      // scopeRefId and roomIds are meaningless here.
      return {
        ...base,
        roomIds: normalise([...active.keys()]),
        skipped: { inactive: [], unknown: [] },
      };
    }

    case "floor": {
      // A floor selection without a floor is never "all rooms" by accident.
      // Silently widening scope is the worst failure this module can have, so
      // it is an error, not a fallback.
      if (request.scopeRefId == null) {
        throw new ScopeError('scope "floor" requires scopeRefId (the floor id)');
      }
      const roomIds = normalise(
        [...active.values()].filter((r) => r.floorId === request.scopeRefId).map((r) => r.id),
      );
      // An empty floor is a valid answer (zero rooms), not an error — the caller
      // decides what applying to nothing means.
      return { ...base, roomIds, skipped: { inactive: [], unknown: [] } };
    }

    case "room":
    case "rooms": {
      const requested = request.roomIds ?? [];
      const resolved: number[] = [];
      const inactive: number[] = [];
      const unknown: number[] = [];
      for (const id of new Set(requested)) {
        if (active.has(id)) resolved.push(id);
        else if (known.has(id)) inactive.push(id); // exists but merged/deactivated
        else unknown.push(id); // no such room
      }
      return {
        ...base,
        roomIds: normalise(resolved),
        skipped: { inactive: normalise(inactive), unknown: normalise(unknown) },
      };
    }

    default: {
      // Exhaustiveness guard — a new scope kind must be handled, not silently
      // resolve to nothing.
      const never: never = request.scope;
      throw new ScopeError(`unhandled scope: ${String(never)}`);
    }
  }
}

/** The database-backed entry point. Every caller in the app goes through here. */
export async function resolveRoomScope(
  db: D1Database,
  request: ScopeRequest,
): Promise<ScopeResolution> {
  const orm = drizzle(db);
  const all = await orm
    .select({ id: rooms.id, floorId: rooms.floorId, isActive: rooms.isActive })
    .from(rooms)
    .all();
  // rooms.isActive is a boolean-mode integer; the driver returns it already
  // coerced, but guard anyway so a raw 0/1 cannot leak an inactive room in.
  return resolveScope(
    request,
    all.map((r) => ({ id: r.id, floorId: r.floorId, isActive: Boolean(r.isActive) })),
  );
}
