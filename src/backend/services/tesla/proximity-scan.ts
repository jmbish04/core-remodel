/**
 * @fileoverview Proximity scan — the park pipeline's decision 1.d (0032 D1 / 0022 §6.3).
 *
 * When the car PARKS somewhere that is NOT home/work (1.a), NOT a stop on the active
 * drive (1.b), and NOT a registered showroom (1.c), this asks Google Places "what
 * remodel-relevant business is right here?" and, if it finds a plausible one that is
 * not already in the directory and not excluded, STAGES it for human review rather
 * than silently creating a store from a guess (the AGENTS.md "resolving an ambiguous
 * parent" rule). The staging is three linked writes:
 *
 *   1. a `showroom_store_hitl_queue` candidate (userDecision = TBD) — the Park-Finds inbox row;
 *   2. a detour stop on the active drive (`is_detour`, points at the candidate) — when on a drive;
 *   3. a discovery soft arrival (`showroom_visit_log` with `hitl_queue_id`, no store_id) — so the
 *      find shows up as a pending visit and gets a dwell on drive-away.
 *
 * COST: Places is billed, so this runs at most ONCE per park (the detector emits
 * `park` exactly once) and only when 1.a–1.c all missed. It is gated by the
 * `tesla_proximity_scan_enabled` config switch AND the maps service's own per-SKU
 * quota hard-disable (`placesNearby` returns `[]` when the Places bucket is spent).
 * Remodel-relevance (decision-tree node D0) is enforced by the Places `includedTypes`
 * filter — only home-improvement place types are requested, so a gas station or a
 * restaurant never surfaces. (A richer Gemini relevance/one-liner pass is a documented
 * follow-up; the type filter is the deterministic, $0 gate for now.)
 */
import { projectSystemVariables } from "@backend/db/schema/home/project_system_variables";
import { driveLists } from "@backend/db/schema/drives/drive_lists";
import { driveListStops } from "@backend/db/schema/drives/drive_list_stops";
import { parkSessions } from "@backend/db/schema/system/park-sessions";
import { showroomExclusions } from "@backend/db/schema/showroom/exclusions";
import { showroomStoreHitlQueue } from "@backend/db/schema/showroom/store_hitl_queue";
import { showroomStores } from "@backend/db/schema/showroom/stores";
import { showroomVisitLog } from "@backend/db/schema/showroom/visit_log";
import { haversineMeters } from "@backend/services/drive-geo-match";
import { GoogleMapsService } from "@backend/services/google/maps";
import type { GpsSource } from "@backend/services/tesla/visit-sessions";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

/**
 * Google Places (New) types that plausibly indicate a remodel/showroom find. Only
 * these are requested, so the scan never surfaces an irrelevant business. All are
 * valid Places API "Table A" types — an unknown type would 400 the whole request.
 */
export const REMODEL_PLACE_TYPES = [
  "furniture_store",
  "home_goods_store",
  "hardware_store",
  "home_improvement_store",
] as const;

const DEFAULT_SCAN_RADIUS_M = 250;

export interface ProximityScanInput {
  latitude: number;
  longitude: number;
  gpsSource: GpsSource;
  /** The park session to link the find back to (best-effort). */
  parkSessionId?: number;
}

export interface ProximityScanResult {
  scanned: boolean;
  reason?:
    | "disabled"
    | "no-candidates"
    | "already-known"
    | "excluded"
    | "already-queued"
    | "created"
    | "error";
  hitlQueueId?: number;
  detourStopId?: number;
  visitLogId?: number;
  driveListId?: number;
  candidate?: {
    placeId: string;
    name: string;
    categoryGuess: string | null;
    distanceM: number;
  };
}

interface ScanConfig {
  enabled: boolean;
  radiusM: number;
}

/** Read the proximity-scan switch + radius from config (same read path as the detector). */
async function readScanConfig(env: Env): Promise<ScanConfig> {
  try {
    const db = drizzle(env.DB);
    const rows = await db
      .select({ k: projectSystemVariables.variableKey, v: projectSystemVariables.valueText })
      .from(projectSystemVariables)
      .where(
        // Two literal keys — well under the 100-param cap.
        inArray(projectSystemVariables.variableKey, [
          "tesla_proximity_scan_enabled",
          "tesla_proximity_radius_m",
        ]),
      );
    const by = new Map(rows.map((r) => [r.k, r.v]));
    const rawEnabled = by.get("tesla_proximity_scan_enabled");
    // Default ON: a park-find is opt-out. Only an explicit "false"/"0" disables.
    const enabled = rawEnabled == null ? true : !/^(false|0|off|no)$/i.test(rawEnabled.trim());
    const radiusN = Number(by.get("tesla_proximity_radius_m"));
    const radiusM = Number.isFinite(radiusN) && radiusN > 0 ? radiusN : DEFAULT_SCAN_RADIUS_M;
    return { enabled, radiusM };
  } catch (err) {
    // Fail CLOSED: a config-read error (D1 blip / misconfig) must NOT default to
    // running billable Places calls. Better a missed park-find than surprise spend.
    console.error("[proximity-scan] readScanConfig failed — disabling scan:", err);
    return { enabled: false, radiusM: DEFAULT_SCAN_RADIUS_M };
  }
}

/**
 * Run decision 1.d for a confirmed park at (lat,lng). Returns what it staged (or why
 * it did not). Never throws — the caller runs this off `waitUntil` and a failed scan
 * must never break ingestion. All Places spend is inside `placesNearby`, which itself
 * hard-disables on quota.
 */
export async function proximityScan(
  env: Env,
  input: ProximityScanInput,
): Promise<ProximityScanResult> {
  try {
    // Reject a non-finite / out-of-range fix before spending a Places call on it —
    // a bad coordinate can't produce a real park-find and would just burn quota.
    if (
      !Number.isFinite(input.latitude) ||
      !Number.isFinite(input.longitude) ||
      input.latitude < -90 ||
      input.latitude > 90 ||
      input.longitude < -180 ||
      input.longitude > 180
    ) {
      return { scanned: false, reason: "error" };
    }

    const cfg = await readScanConfig(env);
    if (!cfg.enabled) return { scanned: false, reason: "disabled" };

    const maps = new GoogleMapsService(env);
    const places = await maps.placesNearby(input.latitude, input.longitude, cfg.radiusM, {
      includedTypes: [...REMODEL_PLACE_TYPES],
      maxResults: 10,
    });
    if (places.length === 0) return { scanned: true, reason: "no-candidates" };

    // Rank by distance from the park point; keep only those actually within radius.
    const ranked = places
      .map((p) => ({
        p,
        distanceM: p.location
          ? Math.round(
              haversineMeters(
                { lat: input.latitude, lng: input.longitude },
                { lat: p.location.latitude, lng: p.location.longitude },
              ),
            )
          : Number.POSITIVE_INFINITY,
      }))
      .filter((r) => r.distanceM <= cfg.radiusM)
      .sort((a, b) => a.distanceM - b.distanceM);
    if (ranked.length === 0) return { scanned: true, reason: "no-candidates" };

    const db = drizzle(env.DB);
    // The ≤10 candidate place ids drive every dedup lookup — filter by them (an
    // inArray over ≤10 values, well under D1's 100-param cap) instead of scanning
    // the whole stores / exclusions / queue tables on every park.
    const candidatePlaceIds = ranked.map((r) => r.p.placeId);

    // Already a registered store? (exact place_id match — the robust dedupe key.)
    const knownStores = await db
      .select({ placeId: showroomStores.placeId })
      .from(showroomStores)
      .where(inArray(showroomStores.placeId, candidatePlaceIds))
      .all();
    const knownPlaceIds = new Set(knownStores.map((s) => s.placeId).filter(Boolean) as string[]);

    // Already excluded? (a prior "not relevant".)
    const exclusions = await db
      .select({ placeId: showroomExclusions.placeId })
      .from(showroomExclusions)
      .where(inArray(showroomExclusions.placeId, candidatePlaceIds))
      .all();
    const excludedPlaceIds = new Set(exclusions.map((e) => e.placeId).filter(Boolean) as string[]);

    // Already queued and undecided? (don't stack a second TBD for the same place.)
    const queued = await db
      .select({ placeId: showroomStoreHitlQueue.placeId })
      .from(showroomStoreHitlQueue)
      .where(
        and(
          eq(showroomStoreHitlQueue.userDecision, "TBD"),
          inArray(showroomStoreHitlQueue.placeId, candidatePlaceIds),
        ),
      )
      .all();
    const queuedPlaceIds = new Set(queued.map((q) => q.placeId).filter(Boolean) as string[]);

    const fresh = ranked.find(
      (r) =>
        !knownPlaceIds.has(r.p.placeId) &&
        !excludedPlaceIds.has(r.p.placeId) &&
        !queuedPlaceIds.has(r.p.placeId),
    );
    if (!fresh) {
      // Every candidate is already accounted for — say which kind, for the receipts.
      const top = ranked[0].p.placeId;
      if (knownPlaceIds.has(top)) return { scanned: true, reason: "already-known" };
      if (excludedPlaceIds.has(top)) return { scanned: true, reason: "excluded" };
      return { scanned: true, reason: "already-queued" };
    }

    // Active drive context (a detour stop needs one; a find can also happen off-drive).
    const [active] = await db
      .select({ id: driveLists.id })
      .from(driveLists)
      .where(eq(driveLists.isActive, true))
      .limit(1);
    const driveListId = active?.id;

    const place = fresh.p;
    const categoryGuess = place.primaryType ?? place.types?.[0] ?? null;
    const name = place.displayName ?? "Unknown place";
    const description = buildOneLiner(name, categoryGuess, place.formattedAddress);
    const scanPacket = {
      parkedAt: { latitude: input.latitude, longitude: input.longitude },
      chosen: {
        placeId: place.placeId,
        name,
        distanceM: fresh.distanceM,
        primaryType: place.primaryType,
        rating: place.rating,
        userRatingCount: place.userRatingCount,
      },
      considered: ranked.slice(0, 5).map((r) => ({
        placeId: r.p.placeId,
        name: r.p.displayName,
        distanceM: r.distanceM,
        primaryType: r.p.primaryType,
      })),
      radiusM: cfg.radiusM,
    };

    // ── Staged writes (insert-then-link; each generated id feeds the next, so this
    //    can't be one db.batch — write sequentially, best-effort past the anchor row).
    // 1) The HITL candidate — the durable anchor. If this fails, nothing is staged.
    const [hitl] = await db
      .insert(showroomStoreHitlQueue)
      .values({
        name,
        description,
        latitude: place.location?.latitude ?? input.latitude,
        longitude: place.location?.longitude ?? input.longitude,
        placeId: place.placeId,
        userDecision: "TBD",
        driveListId: driveListId ?? null,
        proximityScanJson: JSON.stringify(scanPacket),
        categoryGuess,
      })
      .returning({ id: showroomStoreHitlQueue.id });
    const hitlQueueId = hitl?.id;
    if (hitlQueueId == null) return { scanned: true, reason: "error" };

    // 2) Detour stop on the active drive (best-effort; only when on a drive).
    let detourStopId: number | undefined;
    if (driveListId != null) {
      try {
        const [stop] = await db
          .insert(driveListStops)
          .values({
            driveListId,
            name,
            // The Places `formattedAddress` is a full address — it belongs in
            // `address`, not `city` (which is a city name for display/geocoding).
            address: place.formattedAddress ?? null,
            latitude: place.location?.latitude ?? input.latitude,
            longitude: place.location?.longitude ?? input.longitude,
            note: description,
            kind: "pitstop",
            isOptional: true,
            suggested: true,
            isDetour: true,
            hitlQueueId,
          })
          .returning({ id: driveListStops.id });
        detourStopId = stop?.id;
      } catch (err) {
        console.error("[proximity-scan] detour stop insert failed:", err);
      }
    }

    // 3) Discovery soft arrival (best-effort) — store_id null, hitl_queue_id set (XOR-ok
    //    while unconfirmed). Shows in Visit Logs pending; finalized on drive-away.
    let visitLogId: number | undefined;
    try {
      const [visit] = await db
        .insert(showroomVisitLog)
        .values({
          hitlQueueId,
          driveListId: driveListId ?? null,
          stopId: detourStopId ?? null,
          arrivalAt: new Date(),
          status: "TESLA_SOFT_ARRIVAL",
          gpsSource: input.gpsSource,
          latitude: input.latitude,
          longitude: input.longitude,
          matchDistanceM: fresh.distanceM,
          provenanceJson: JSON.stringify({
            latitude: input.latitude,
            longitude: input.longitude,
            gpsSource: input.gpsSource,
            driveListId: driveListId ?? null,
            hitlQueueId,
            placeId: place.placeId,
            discovery: true,
          }),
        })
        .returning({ id: showroomVisitLog.id });
      visitLogId = visit?.id;
    } catch (err) {
      console.error("[proximity-scan] discovery soft-arrival insert failed:", err);
    }

    // 4) Link the park session to the find (best-effort).
    if (input.parkSessionId != null) {
      try {
        await db
          .update(parkSessions)
          .set({ hitlQueueId, visitLogId: visitLogId ?? null, updatedAt: new Date() })
          .where(eq(parkSessions.id, input.parkSessionId));
      } catch (err) {
        console.error("[proximity-scan] link park session failed:", err);
      }
    }

    return {
      scanned: true,
      reason: "created",
      hitlQueueId,
      detourStopId,
      visitLogId,
      driveListId,
      candidate: { placeId: place.placeId, name, categoryGuess, distanceM: fresh.distanceM },
    };
  } catch (err) {
    console.error("[proximity-scan] failed:", err);
    return { scanned: false, reason: "error" };
  }
}

/** A short human hint for the Park-Finds card, derived from the Places result. */
function buildOneLiner(name: string, categoryGuess: string | null, address: string | null): string {
  const kind = categoryGuess ? categoryGuess.replace(/_/g, " ") : "remodel-relevant business";
  const where = address ? ` at ${address}` : "";
  return `Parked near ${name} — a ${kind}${where}. Flagged as a possible remodel find; confirm to add it to the directory.`;
}
