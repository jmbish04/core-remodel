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
import { and, eq, isNotNull, notInArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

/** A park counts as "at" a showroom within this many metres. */
export const SHOWROOM_MATCH_RADIUS_M = 250;

/** Where an arrival fix came from — matches the gps_source column's enum. */
export type GpsSource = "tesla-telemetry" | "tesla-webhook" | "device" | "manual";

export interface ParkFix {
  latitude: number;
  longitude: number;
  gpsSource: GpsSource;
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

  // Dedup within THIS drive: an OPEN soft arrival = a TESLA_SOFT_ARRIVAL row for
  // this store on this drive. Scoping to the active drive means a lingering,
  // never-finalized soft arrival from an EARLIER drive at the same store can't
  // block a fresh visit today.
  const [openSoft] = await db
    .select({ id: showroomVisitLog.id })
    .from(showroomVisitLog)
    .where(
      and(
        eq(showroomVisitLog.storeId, store.id),
        eq(showroomVisitLog.driveListId, active.id),
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
      // Engagement depth is unknown until the human classifies it; default handles it.
      gpsSource: fix.gpsSource,
      latitude: fix.latitude,
      longitude: fix.longitude,
      // Attestation strength + provenance (0032 V1): how far the park was from the
      // matched store, and explicit fix fields + active-drive id for the receipts
      // drawer (serialize named fields, not the raw object, so it can't bloat or
      // carry an unexpected non-serializable shape).
      matchDistanceM: store.distanceM,
      provenanceJson: JSON.stringify({
        latitude: fix.latitude,
        longitude: fix.longitude,
        gpsSource: fix.gpsSource,
        driveListId: active.id,
        matchedStoreId: store.id,
      }),
    })
    .returning({ id: showroomVisitLog.id });

  return { staged: true, visitLogId: row?.id, storeId: store.id, distanceM: store.distanceM };
}

export interface FinalizeResult {
  finalized: number;
  visitLogIds: number[];
}

/**
 * On drive-away, finalize the still-open soft arrivals FOR THE ACTIVE DRIVE into
 * TESLA_STAGED rows (arrival copied, departure = now, dwell computed), linked by
 * `softArrivalId`. The UNIQUE index makes this idempotent — a second call inserts
 * nothing. Never spans a transaction (D1 has none); each finalize is one insert.
 *
 * Scoped to the active drive on purpose: a stale soft arrival that a PRIOR drive
 * never finalized (e.g. a missed drive-away) must NOT be closed here with today's
 * timestamp and a bogus multi-day dwell.
 */
export async function finalizeSoftArrivals(env: Env): Promise<FinalizeResult> {
  const db = drizzle(env.DB);
  const now = new Date();

  const [active] = await db
    .select({ id: driveLists.id })
    .from(driveLists)
    .where(eq(driveLists.isActive, true))
    .limit(1);
  if (!active) return { finalized: 0, visitLogIds: [] };

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
      matchDistanceM: showroomVisitLog.matchDistanceM,
      provenanceJson: showroomVisitLog.provenanceJson,
    })
    .from(showroomVisitLog)
    .where(
      and(
        eq(showroomVisitLog.status, "TESLA_SOFT_ARRIVAL"),
        eq(showroomVisitLog.driveListId, active.id),
        // Type-safe correlated subquery — `staged` selects only non-null
        // soft_arrival_ids, so NOT IN can't be poisoned by a NULL.
        notInArray(showroomVisitLog.id, staged),
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
        gpsSource: soft.gpsSource,
        latitude: soft.latitude,
        longitude: soft.longitude,
        matchDistanceM: soft.matchDistanceM,
        provenanceJson: soft.provenanceJson,
        softArrivalId: soft.id,
      })
      .onConflictDoNothing({ target: showroomVisitLog.softArrivalId })
      .returning({ id: showroomVisitLog.id });
    if (row?.id) visitLogIds.push(row.id);
  }

  return { finalized: visitLogIds.length, visitLogIds };
}
