/**
 * @fileoverview Live per-stop timing for a drive — "stay ~N min", ETA, and
 * "won't make it before close".
 *
 * Deliberately RESPECTS the drive's own stop order (the user sequenced it) and
 * runs a cheap forward simulation along it, rather than resequencing. Travel
 * time is ESTIMATED from straight-line distance (no Google Routes call), so this
 * is free to recompute on every viewport load — accurate enough for "leave now
 * or you'll miss it" guidance, and it never bills a Maps SKU.
 *
 * All clock math is California minutes-from-midnight.
 */
import { driveListStops, driveLists, showroomStoreHours } from "@backend/db";
import { asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { distanceMeters, localMinutesInLA } from "./drive-home-arrival-rules";

type RemodelDb = ReturnType<typeof drizzle>;

/** Typical time spent inside a showroom, when nothing forces it shorter. */
const DEFAULT_DWELL_MIN = 30;
/** Effective door-to-door speed for the estimate (Bay Area mixed streets/hwy). */
const EFFECTIVE_KMH = 32;
/** Fixed parking/wayfinding overhead added to each leg. */
const LEG_OVERHEAD_MIN = 3;

const DAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

/** LA weekday enum for an instant. */
function laWeekday(at: Date): (typeof DAYS)[number] {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "short",
  }).format(at);
  const map: Record<string, (typeof DAYS)[number]> = {
    Sun: "SUNDAY",
    Mon: "MONDAY",
    Tue: "TUESDAY",
    Wed: "WEDNESDAY",
    Thu: "THURSDAY",
    Fri: "FRIDAY",
    Sat: "SATURDAY",
  };
  return map[wd] ?? "MONDAY";
}

/** Estimated drive minutes between two coords. */
function estDriveMinutes(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const meters = distanceMeters(a.lat, a.lng, b.lat, b.lng);
  return Math.round((meters / 1000 / EFFECTIVE_KMH) * 60) + LEG_OVERHEAD_MIN;
}

/** "2:40 PM" from California minutes-from-midnight. */
export function fmtLocalMinute(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

export interface StopTiming {
  stopId: number;
  /** ETA at this stop (California minutes-from-midnight) + formatted. */
  arriveMinute: number | null;
  etaLocal: string | null;
  /** Suggested minutes to stay (capped by closing time). */
  stayMinutes: number | null;
  /** true = fits, false = won't make it, null = can't tell (no coords/hours). */
  feasible: boolean | null;
  reason: string | null;
  opensAt: string | null;
  closesAt: string | null;
}

export interface DriveTiming {
  startedAt: number | null;
  /** The minute the projection starts from (California minutes-from-midnight). */
  startMinute: number;
  day: (typeof DAYS)[number];
  /** true when the projection anchors on real start time+location (activated). */
  fromActiveStart: boolean;
  stops: StopTiming[];
}

/**
 * Compute per-stop timing for a drive by slug. Anchors on the drive's captured
 * start (time + location) when it has been activated; otherwise projects from
 * "now" with the first stop as the origin (so timings are relative).
 */
export async function getDriveTiming(db: RemodelDb, slug: string): Promise<DriveTiming | null> {
  const [drive] = await db
    .select({
      id: driveLists.id,
      startedAt: driveLists.startedAt,
      startLat: driveLists.startLatitude,
      startLng: driveLists.startLongitude,
    })
    .from(driveLists)
    .where(eq(driveLists.slug, slug))
    .limit(1);
  if (!drive) return null;

  const stops = await db
    .select({
      id: driveListStops.id,
      showroomStoreId: driveListStops.showroomStoreId,
      latitude: driveListStops.latitude,
      longitude: driveListStops.longitude,
      skipped: driveListStops.skipped,
      suggested: driveListStops.suggested,
    })
    .from(driveListStops)
    .where(eq(driveListStops.driveListId, drive.id))
    .orderBy(asc(driveListStops.sortOrder), asc(driveListStops.id));

  // Only route the stops the driver will actually visit, in order.
  const active = stops.filter((s) => !s.skipped && !s.suggested);
  // `startedAt` is a drizzle timestamp column → already a Date (or null).
  const anchor = drive.startedAt ?? new Date();
  const day = laWeekday(anchor);
  const startMinute = localMinutesInLA(anchor);
  const fromActiveStart = drive.startedAt != null && drive.startLat != null && drive.startLng != null;

  // One query for every linked showroom's hours on this weekday.
  const storeIds = Array.from(
    new Set(active.map((s) => s.showroomStoreId).filter((v): v is number => v != null)),
  );
  const hoursByStore = new Map<number, { openMin: number; closeMin: number }>();
  const allHours = storeIds.length
    ? await db.select().from(showroomStoreHours).where(inArray(showroomStoreHours.showroomId, storeIds))
    : [];
  for (const h of allHours) {
    if (h.day !== day) continue; // filtered in JS — small per-drive set
    hoursByStore.set(h.showroomId, {
      openMin: h.openHour * 60 + h.openMinute,
      closeMin: h.closeHour * 60 + h.closeMinute,
    });
  }

  let prev: { lat: number; lng: number } | null =
    fromActiveStart && drive.startLat != null && drive.startLng != null
      ? { lat: drive.startLat, lng: drive.startLng }
      : null;
  let clock = startMinute;

  const out: StopTiming[] = [];
  for (const s of active) {
    if (s.latitude == null || s.longitude == null) {
      out.push({
        stopId: s.id,
        arriveMinute: null,
        etaLocal: null,
        stayMinutes: null,
        feasible: null,
        reason: "No location for this stop",
        opensAt: null,
        closesAt: null,
      });
      continue;
    }
    const here = { lat: s.latitude, lng: s.longitude };
    const drive2 = prev ? estDriveMinutes(prev, here) : 0;
    const arrive = clock + drive2;
    const hrs = s.showroomStoreId != null ? hoursByStore.get(s.showroomStoreId) : undefined;

    let stay: number;
    let feasible: boolean | null;
    let reason: string | null;
    if (hrs) {
      const wait = Math.max(0, hrs.openMin - arrive);
      const startVisit = arrive + wait;
      const avail = hrs.closeMin - startVisit;
      if (avail <= 0) {
        feasible = false;
        stay = 0;
        reason = `Won't make it — closes ${fmtLocalMinute(hrs.closeMin)}`;
        clock = arrive; // no visit; keep rolling
      } else {
        stay = Math.min(DEFAULT_DWELL_MIN, avail);
        feasible = true;
        reason =
          avail < DEFAULT_DWELL_MIN
            ? `Tight — only ~${stay} min before ${fmtLocalMinute(hrs.closeMin)} close`
            : null;
        clock = startVisit + stay;
      }
    } else {
      stay = DEFAULT_DWELL_MIN;
      feasible = null;
      reason = "Hours unknown — call ahead";
      clock = arrive + stay;
    }

    out.push({
      stopId: s.id,
      arriveMinute: arrive,
      etaLocal: fmtLocalMinute(arrive),
      stayMinutes: stay,
      feasible,
      reason,
      opensAt: hrs ? fmtLocalMinute(hrs.openMin) : null,
      closesAt: hrs ? fmtLocalMinute(hrs.closeMin) : null,
    });
    prev = here;
  }

  return {
    startedAt: drive.startedAt ? Math.floor(drive.startedAt.getTime() / 1000) : null,
    startMinute,
    day,
    fromActiveStart,
    stops: out,
  };
}
