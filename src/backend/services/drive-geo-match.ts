/**
 * @fileoverview Auto-visit geo-matching for the Tesla park webhook.
 *
 * When the car parks, the webhook hands us a coordinate; this module answers
 * "which drive stop is that, and what's next?". It scans every UNVISITED stop
 * on ACTIVE drives, finds the nearest one within a tolerance radius, marks it
 * visited (mirroring the manual check-off in the viewport, including the same
 * drive auto-archive behaviour), and returns the next unvisited stop so the
 * webhook can push it to the car's navigation.
 *
 * Coordinates come from the stop itself, else its linked showroom — the same
 * `coalesce` the map markers use.
 */
import { driveListStops, driveLists, showroomStores } from "@backend/db";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

type RemodelDb = ReturnType<typeof drizzle>;

/** A stop with a resolved coordinate, in drive order. */
interface GeoStop {
  id: number;
  driveListId: number;
  driveSlug: string;
  sortOrder: number;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  visited: boolean;
}

/**
 * Great-circle distance in metres (haversine). Good to well under a metre at
 * city scale, which is far tighter than the match radius needs.
 */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6_371_000; // Earth radius, metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Default match radius: a stop counts as "here" within 250 m of the parked car. */
export const DEFAULT_MATCH_RADIUS_M = 250;

export interface AutoVisitResult {
  /** The stop we matched and marked visited, if any. */
  matched: { id: number; name: string; driveSlug: string; distanceM: number } | null;
  /** The next unvisited stop on the same drive, to navigate to (if any). */
  next: { id: number; name: string; address: string | null; lat: number; lng: number } | null;
}

/**
 * Load every unvisited stop on active drives with a usable coordinate.
 * Exported so the webhook can distinguish "no candidates" from "no match".
 */
async function loadActiveStops(db: RemodelDb): Promise<GeoStop[]> {
  const rows = await db
    .select({
      id: driveListStops.id,
      driveListId: driveListStops.driveListId,
      driveSlug: driveLists.slug,
      sortOrder: driveListStops.sortOrder,
      name: driveListStops.name,
      address: driveListStops.address,
      visited: driveListStops.visited,
      lat: sql<number | null>`coalesce(${driveListStops.latitude}, ${showroomStores.latitude})`,
      lng: sql<number | null>`coalesce(${driveListStops.longitude}, ${showroomStores.longitude})`,
    })
    .from(driveListStops)
    .innerJoin(driveLists, eq(driveListStops.driveListId, driveLists.id))
    .leftJoin(showroomStores, eq(driveListStops.showroomStoreId, showroomStores.id))
    .where(eq(driveLists.status, "active"))
    .orderBy(asc(driveListStops.driveListId), asc(driveListStops.sortOrder))
    .all();

  return rows
    .filter((r): r is typeof r & { lat: number; lng: number } => r.lat != null && r.lng != null)
    .map((r) => ({
      id: r.id,
      driveListId: r.driveListId,
      driveSlug: r.driveSlug,
      sortOrder: r.sortOrder,
      name: r.name,
      address: r.address,
      latitude: r.lat,
      longitude: r.lng,
      visited: r.visited,
    }));
}

/**
 * Match a parked coordinate to the nearest unvisited active-drive stop, mark it
 * visited, and return that stop plus the next unvisited stop on its drive.
 *
 * Returns `{ matched: null }` when nothing is within `radiusM` — the caller
 * should treat that as "parked somewhere that isn't a stop" and do nothing.
 */
export async function matchAndMarkVisited(
  db: RemodelDb,
  coord: { lat: number; lng: number },
  radiusM = DEFAULT_MATCH_RADIUS_M,
): Promise<AutoVisitResult> {
  const stops = await loadActiveStops(db);
  const unvisited = stops.filter((s) => !s.visited);

  // Nearest unvisited stop within the radius wins.
  let best: { stop: GeoStop; d: number } | null = null;
  for (const s of unvisited) {
    const d = haversineMeters(coord, { lat: s.latitude, lng: s.longitude });
    if (d <= radiusM && (!best || d < best.d)) best = { stop: s, d };
  }
  if (!best) return { matched: null, next: null };

  const hit = best.stop;
  // Mark visited (same write the manual toggle does).
  await db
    .update(driveListStops)
    .set({ visited: true, visitedAt: new Date() })
    .where(eq(driveListStops.id, hit.id))
    .run();

  // Auto-archive the drive if that was the last open stop (mirrors the PATCH
  // route's completion logic so the two write paths stay consistent).
  const [counts] = await db
    .select({
      total: sql<number>`count(${driveListStops.id})`,
      visited: sql<number>`coalesce(sum(${driveListStops.visited}), 0)`,
    })
    .from(driveListStops)
    .where(eq(driveListStops.driveListId, hit.driveListId));
  if (Number(counts?.total ?? 0) > 0 && Number(counts?.visited ?? 0) === Number(counts?.total ?? 0)) {
    await db
      .update(driveLists)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(driveLists.id, hit.driveListId))
      .run();
  }

  // Next unvisited stop on the SAME drive, in order, after the matched one.
  const next =
    stops.find(
      (s) => s.driveListId === hit.driveListId && !s.visited && s.id !== hit.id && s.sortOrder >= hit.sortOrder,
    ) ??
    stops.find((s) => s.driveListId === hit.driveListId && !s.visited && s.id !== hit.id) ??
    null;

  return {
    matched: { id: hit.id, name: hit.name, driveSlug: hit.driveSlug, distanceM: Math.round(best.d) },
    next: next
      ? { id: next.id, name: next.name, address: next.address, lat: next.latitude, lng: next.longitude }
      : null,
  };
}
