/**
 * @fileoverview Measurement service (0006) — the single source of truth for
 * creating, listing, and summarizing master measurements.
 *
 * Both the HTTP API (`/api/measurements`, see routes/measurements.ts) and the
 * measurement MCP bridge (routes/mcp/tools/*.ts — so Claude can record dimensions during a
 * live measuring session) go through these functions.  Centralizing them here means
 * room/floor validation and the insert shape can never DRIFT between the two surfaces
 * (a real risk once two callers write to the same table).
 *
 * Canonical units: dimensions are stored in US terms — feet (integer) + inches
 * (decimal) per side, and areaSqFt.  The frontend unit toggle converts for display
 * and entry only; the stored values never change.  See [[0006-measurements-purpose]]:
 * the value is exact numbers for material takeoffs, so the create path is deliberately
 * permissive about which dimensions are present (a window might be W×H with no depth).
 */

import {
  type MeasurementElementType,
  type MeasurementSource,
  floors,
  measurements,
  rooms,
} from "@backend/db";
import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { computeRoomAreaSqFt } from "@backend/services/room-geometry";

/** A Drizzle D1 handle — identical to `drizzle(env.DB)` in the routes. */
type Db = ReturnType<typeof import("drizzle-orm/d1").drizzle>;

/** A measurement DB row (the drizzle select shape). */
export type MeasurementRow = typeof measurements.$inferSelect;

/** Reasons a room/floor target can be rejected (mapped to HTTP 400 / MCP error). */
export type MeasurementTargetError = "room_not_found" | "room_inactive" | "floor_not_found";

// ---------------------------------------------------------------------------
// Target validation (room must be ACTIVE; floor must exist)
// ---------------------------------------------------------------------------

/**
 * Validate that `roomId` points to an ACTIVE room.
 * @returns an error code when invalid, or null when ok.
 */
export async function validateRoomTarget(
  db: Db,
  roomId: number,
): Promise<"room_not_found" | "room_inactive" | null> {
  const room = await db
    .select({ id: rooms.id, isActive: rooms.isActive })
    .from(rooms)
    .where(eq(rooms.id, roomId))
    .get();
  if (!room) return "room_not_found";
  if (!room.isActive) return "room_inactive";
  return null;
}

/** Validate that `floorId` references an existing floor. */
export async function floorExists(db: Db, floorId: number): Promise<boolean> {
  const floor = await db.select({ id: floors.id }).from(floors).where(eq(floors.id, floorId)).get();
  return Boolean(floor);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Fields accepted when creating a measurement.  Mirrors the API's
 * `MeasurementCreateSchema`: `elementType` is required, everything else is
 * optional/nullable, and the handful of defaults below are applied here (NOT as
 * caller defaults) so there is exactly one place that decides them.
 */
export interface CreateMeasurementInput {
  roomId?: number | null;
  floorId?: number | null;
  elementType: MeasurementElementType;
  label?: string | null;
  lengthFeet?: number | null;
  lengthInches?: number | null;
  widthFeet?: number | null;
  widthInches?: number | null;
  heightFeet?: number | null;
  heightInches?: number | null;
  span?: Record<string, unknown> | null;
  areaSqFt?: number | null;
  quantity?: number;
  source?: MeasurementSource;
  isApproximate?: boolean;
  accuracyNote?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Result of {@link createMeasurement} — a clean row, or a 400-worthy target error. */
export type CreateMeasurementResult =
  | { ok: true; row: MeasurementRow }
  | { ok: false; error: MeasurementTargetError };

/**
 * Validate the room/floor target and insert one measurement.
 *
 * Returns a discriminated result rather than throwing so each caller maps it to its
 * own transport (HTTP 400 vs an MCP error frame).  `span`/`metadata` are serialized
 * to JSON strings here, matching the column types.
 */
export async function createMeasurement(
  db: Db,
  input: CreateMeasurementInput,
): Promise<CreateMeasurementResult> {
  // Only active rooms are valid targets.
  if (input.roomId !== undefined && input.roomId !== null) {
    if (!Number.isInteger(input.roomId)) {
      return { ok: false, error: "room_not_found" };
    }
    const roomError = await validateRoomTarget(db, input.roomId);
    if (roomError) return { ok: false, error: roomError };
  }
  if (input.floorId !== undefined && input.floorId !== null) {
    if (!Number.isInteger(input.floorId) || !(await floorExists(db, input.floorId))) {
      return { ok: false, error: "floor_not_found" };
    }
  }

  

  const [row] = await db
    .insert(measurements)
    .values({
      roomId: input.roomId ?? null,
      floorId: input.floorId ?? null,
      elementType: input.elementType,
      label: input.label ?? null,
      lengthFeet: input.lengthFeet ?? null,
      lengthInches: input.lengthInches ?? null,
      widthFeet: input.widthFeet ?? null,
      widthInches: input.widthInches ?? null,
      heightFeet: input.heightFeet ?? null,
      heightInches: input.heightInches ?? null,
      spanJson: input.span != null ? JSON.stringify(input.span) : null,
      areaSqFt: input.areaSqFt ?? null,
      quantity: input.quantity ?? 1,
      source: input.source ?? "estimated",
      isApproximate: input.isApproximate ?? true,
      accuracyNote: input.accuracyNote ?? null,
      notes: input.notes ?? null,
      metadata: input.metadata != null ? JSON.stringify(input.metadata) : null,
    })
    .returning();

  return { ok: true, row };
}

// ---------------------------------------------------------------------------
// List (read access for the MCP bridge)
// ---------------------------------------------------------------------------

/** Filters for {@link listMeasurements}. All optional; absent = no constraint. */
export interface ListMeasurementsFilter {
  roomId?: number;
  elementTypes?: MeasurementElementType[];
  sources?: MeasurementSource[];
  /** Free-text match across label / notes / accuracy note / element type. */
  q?: string;
  limit?: number;
}

/**
 * List measurements (newest first), filtered.  Used by the MCP bridge so Claude can
 * read what is already recorded — avoiding duplicate entries during a session.
 */
export async function listMeasurements(
  db: Db,
  filter: ListMeasurementsFilter = {},
): Promise<MeasurementRow[]> {
  const conditions = [];
  if (filter.roomId !== undefined) conditions.push(eq(measurements.roomId, filter.roomId));
  if (filter.elementTypes?.length)
    conditions.push(inArray(measurements.elementType, filter.elementTypes));
  if (filter.sources?.length) conditions.push(inArray(measurements.source, filter.sources));
  if (filter.q) {
    // SQLite LIKE is case-insensitive for ASCII, so no lower() wrapper is needed.
    const pat = `%${filter.q}%`;
    conditions.push(
      or(
        like(measurements.label, pat),
        like(measurements.notes, pat),
        like(measurements.accuracyNote, pat),
        like(measurements.elementType, pat),
      )!,
    );
  }
  const whereExpr = conditions.length ? and(...conditions) : undefined;

  return db
    .select()
    .from(measurements)
    .where(whereExpr)
    .orderBy(desc(measurements.datetimeUpdated))
    .limit(Math.min(Math.max(filter.limit ?? 200, 1), 1000))
    .all();
}

// ---------------------------------------------------------------------------
// Active-room resolution (so an MCP caller can map a name → roomId)
// ---------------------------------------------------------------------------

/** A minimal active-room record for room resolution / pickers. */
export interface ActiveRoom {
  id: number;
  roomCode: string;
  roomName: string;
  floorId: number;
  areaSqFt: number | null;
}

/** List active rooms (alphabetical by display name) for `roomId` resolution. */
export async function listActiveRooms(db: Db): Promise<ActiveRoom[]> {
  const rows = await db
    .select({
      id: rooms.id,
      roomCode: rooms.roomCode,
      roomName: rooms.roomName,
      floorId: rooms.floorId,
      lengthFeet: rooms.lengthFeet,
      lengthInches: rooms.lengthInches,
      widthFeet: rooms.widthFeet,
      widthInches: rooms.widthInches,
    })
    .from(rooms)
    .where(eq(rooms.isActive, true))
    .orderBy(asc(rooms.roomName))
    .all();
  // Area is computed on the fly (0043 dropped the stored column).
  return rows.map((r) => ({
    id: r.id,
    roomCode: r.roomCode,
    roomName: r.roomName,
    floorId: r.floorId,
    areaSqFt: computeRoomAreaSqFt(r),
  }));
}

// ---------------------------------------------------------------------------
// Coverage (what still needs measuring — "measure twice, cut once")
// ---------------------------------------------------------------------------

/** Per-room measurement coverage. */
export interface RoomCoverage {
  roomId: number;
  roomCode: string;
  roomName: string;
  measurementCount: number;
  /** Distinct element types recorded for this room (e.g. ["room","window"]). */
  elementTypes: string[];
}

/** Whole-house coverage summary. */
export interface MeasurementCoverage {
  rooms: RoomCoverage[];
  /** Active rooms with ZERO measurements — the work still to do. */
  roomsWithNoMeasurements: RoomCoverage[];
  /** Measurements not tied to any room (roomId is null). */
  unroomedMeasurementCount: number;
  totalMeasurements: number;
}

/**
 * Summarize coverage across all active rooms: how many measurements each has and
 * which element types are recorded, plus which rooms are still empty.  This is the
 * read Claude uses to answer "what still needs measuring?" mid-session.
 */
export async function getMeasurementCoverage(db: Db): Promise<MeasurementCoverage> {
  const activeRooms = await listActiveRooms(db);

  // One grouped pass over measurements: count + distinct element types per room.
  const grouped = await db
    .select({
      roomId: measurements.roomId,
      count: sql<number>`count(*)`,
      types: sql<string | null>`group_concat(distinct ${measurements.elementType})`,
    })
    .from(measurements)
    .groupBy(measurements.roomId)
    .all();

  const byRoom = new Map<number, { count: number; types: string[] }>();
  let unroomedMeasurementCount = 0;
  let totalMeasurements = 0;
  for (const g of grouped) {
    const count = Number(g.count ?? 0);
    totalMeasurements += count;
    if (g.roomId == null) {
      unroomedMeasurementCount += count;
      continue;
    }
    byRoom.set(g.roomId, {
      count,
      types: (g.types ?? "").split(",").map((t) => t.trim()).filter(Boolean).sort(),
    });
  }

  const coverage: RoomCoverage[] = activeRooms.map((room) => {
    const hit = byRoom.get(room.id);
    return {
      roomId: room.id,
      roomCode: room.roomCode,
      roomName: room.roomName,
      measurementCount: hit?.count ?? 0,
      elementTypes: hit?.types ?? [],
    };
  });

  return {
    rooms: coverage,
    roomsWithNoMeasurements: coverage.filter((r) => r.measurementCount === 0),
    unroomedMeasurementCount,
    totalMeasurements,
  };
}
