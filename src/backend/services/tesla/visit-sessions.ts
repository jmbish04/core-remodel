/**
 * @fileoverview Visit-session pipeline (0023 P1/P3) — park → soft arrival, drive-away → finalize.
 *
 * The IFTTT core of the Tesla telemetry feature. Two entry points, both driven by
 * the stream DO (and safe for the poller to call):
 *
 *   • `stageSoftArrival` — on a PARK, if the car is at a registered showroom during
 *     an active drive, stage a `TESLA_SOFT_ARRIVAL` row (arrival only). Deduped so
 *     re-parking / a repeated frame doesn't stack drafts.
 *   • `finalizeSoftArrivals` — on DRIVE-AWAY, close every still-open soft arrival
 *     into a `TESLA_STAGED` row with departure + dwell, linked by `softArrivalId`
 *     (UNIQUE → idempotent).
 *
 * Coordinates are read from `showroom_stores` here (as `drive-geo-match` does);
 * kept behind this one module so the anticipated move to a locations table is a
 * single-file change.
 */
import { driveLists, showroomStores, showroomVisitLog } from "@backend/db";
import { haversineMeters } from "@backend/services/drive-geo-match";
import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

/** A park counts as "at" a showroom within this many metres. */
export const SHOWROOM_MATCH_RADIUS_M = 250;

export interface ParkFix {
  latitude: number;
  longitude: number;
  /** "tesla-telemetry" | "tesla-webhook" | "device" | "manual". */
  gpsSource: string;
}

export interface StageResult {
  staged: boolean;
  reason?: "no-active-drive" | "no-showroom-nearby" | "already-open";
  visitLogId?: number;
  storeId?: number;
  distanceM?: number;
}

/** The nearest registered showroom to a point, within the match radius (or null). */
async function nearestShowroom(
  db: ReturnType<typeof drizzle>,
  fix: ParkFix,
): Promise<{ id: number; distanceM: number } | null> {
  const rows = await db
    .select({ id: showroomStores.id, lat: showroomStores.latitude, lng: showroomStores.longitude })
    .from(showroomStores)
    .where(and(isNotNull(showroomStores.latitude), isNotNull(showroomStores.longitude)))
    .all();

  let best: { id: number; distanceM: number } | null = null;
  for (const r of rows) {
    if (r.lat == null || r.lng == null) continue;
    const d = haversineMeters(
      { lat: fix.latitude, lng: fix.longitude },
      { lat: r.lat, lng: r.lng },
    );
    if (d <= SHOWROOM_MATCH_RADIUS_M && (!best || d < best.distanceM)) {
      best = { id: r.id, distanceM: Math.round(d) };
    }
  }
  return best;
}

/**
 * Stage a soft arrival for a park, if it's at a registered showroom during an
 * active drive. Deduped: if an open soft arrival already exists for this store it
 * returns `already-open` rather than stacking a second draft.
 */
export async function stageSoftArrival(env: Env, fix: ParkFix): Promise<StageResult> {
  const db = drizzle(env.DB);

  const [active] = await db
    .select({ id: driveLists.id })
    .from(driveLists)
    .where(eq(driveLists.isActive, true))
    .limit(1);
  if (!active) return { staged: false, reason: "no-active-drive" };

  const store = await nearestShowroom(db, fix);
  if (!store) return { staged: false, reason: "no-showroom-nearby" };

  // Dedup: an OPEN soft arrival = a TESLA_SOFT_ARRIVAL row for this store with no
  // TESLA_STAGED row finalizing it. If one exists, don't stage another.
  const [openSoft] = await db
    .select({ id: showroomVisitLog.id })
    .from(showroomVisitLog)
    .where(
      and(
        eq(showroomVisitLog.storeId, store.id),
        eq(showroomVisitLog.status, "TESLA_SOFT_ARRIVAL"),
      ),
    )
    .limit(1);
  if (openSoft) return { staged: false, reason: "already-open", storeId: store.id };

  const [row] = await db
    .insert(showroomVisitLog)
    .values({
      storeId: store.id,
      driveListId: active.id,
      arrivalAt: new Date(),
      status: "TESLA_SOFT_ARRIVAL",
      type: "SHOWROOM_IN_PERSON",
      gpsSource: fix.gpsSource,
      latitude: fix.latitude,
      longitude: fix.longitude,
    })
    .returning({ id: showroomVisitLog.id });

  return { staged: true, visitLogId: row?.id, storeId: store.id, distanceM: store.distanceM };
}

export interface FinalizeResult {
  finalized: number;
  visitLogIds: number[];
}

/**
 * On drive-away, finalize every still-open soft arrival into a TESLA_STAGED row
 * (arrival copied, departure = now, dwell computed), linked by `softArrivalId`.
 * The UNIQUE index on `softArrivalId` makes this idempotent — a second call inserts
 * nothing. Never spans a transaction (D1 has none); each finalize is one insert.
 */
export async function finalizeSoftArrivals(env: Env): Promise<FinalizeResult> {
  const db = drizzle(env.DB);
  const now = new Date();

  // Open soft arrivals = TESLA_SOFT_ARRIVAL rows not yet referenced by a staged row.
  const staged = db
    .select({ softId: showroomVisitLog.softArrivalId })
    .from(showroomVisitLog)
    .where(isNotNull(showroomVisitLog.softArrivalId));

  const open = await db
    .select({
      id: showroomVisitLog.id,
      storeId: showroomVisitLog.storeId,
      driveListId: showroomVisitLog.driveListId,
      stopId: showroomVisitLog.stopId,
      arrivalAt: showroomVisitLog.arrivalAt,
      gpsSource: showroomVisitLog.gpsSource,
      latitude: showroomVisitLog.latitude,
      longitude: showroomVisitLog.longitude,
    })
    .from(showroomVisitLog)
    .where(
      and(
        eq(showroomVisitLog.status, "TESLA_SOFT_ARRIVAL"),
        sql`${showroomVisitLog.id} NOT IN ${staged}`,
      ),
    )
    .all();

  const visitLogIds: number[] = [];
  for (const soft of open) {
    const arrival = soft.arrivalAt ?? now;
    const dwellSeconds = Math.max(0, Math.round((now.getTime() - arrival.getTime()) / 1000));
    // onConflictDoNothing on the unique soft_arrival_id index → idempotent finalize.
    const [row] = await db
      .insert(showroomVisitLog)
      .values({
        storeId: soft.storeId,
        driveListId: soft.driveListId,
        stopId: soft.stopId,
        arrivalAt: arrival,
        departureAt: now,
        dwellSeconds,
        status: "TESLA_STAGED",
        type: "SHOWROOM_IN_PERSON",
        gpsSource: soft.gpsSource,
        latitude: soft.latitude,
        longitude: soft.longitude,
        softArrivalId: soft.id,
      })
      .onConflictDoNothing({ target: showroomVisitLog.softArrivalId })
      .returning({ id: showroomVisitLog.id });
    if (row?.id) visitLogIds.push(row.id);
  }

  return { finalized: visitLogIds.length, visitLogIds };
}
