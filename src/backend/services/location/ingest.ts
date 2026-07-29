/**
 * @fileoverview Normalized location ingress (0032 L0) — the one seam every source
 * funnels through.
 *
 * The decoupling in the 0032 plan: a `LocationFix` is a source-agnostic
 * `{lat,lng,when,source,…}`; `ingestLocationFix` records provenance and runs the
 * SAME park pipeline the streaming DO already runs — match a drive stop, check for
 * a home/work arrival, and (if near a registered showroom on the active drive)
 * stage a soft arrival. With this, a phone ping, an AI-supplied coordinate, or a
 * manual "I'm here" stages a visit exactly like a 500 ms telemetry frame.
 *
 * SCOPE (L0): this lands the ingress + the NEW discrete sources (phone / ai /
 * manual). The live streaming DO and the 120 s poller are deliberately NOT
 * rewired here — safely unifying them needs the dwell/park DETECTOR (L1), which
 * tracks prior state to fire a drive-away. Until L1, a soft arrival staged from a
 * discrete source is finalized either by the DO's stream drive-away or by a human
 * in the Visit Logs workspace. No new table, no migration: provenance reuses the
 * existing `device_location` sink (free-text `source`, so `ai`/`manual` need no
 * schema change).
 */
import { matchAndMarkVisited } from "@backend/services/drive-geo-match";
import { maybeEndActiveDriveOnHomeArrival } from "@backend/services/drive-home-arrival";
import { type GpsSource, stageSoftArrival } from "@backend/services/tesla/visit-sessions";
import { deviceLocation } from "@backend/db/schema/system/device-location";
import { drizzle } from "drizzle-orm/d1";

/** Where a fix came from. `tesla-stream`/`tesla-poll` self-record their own evidence. */
export type LocationSource = "tesla-stream" | "tesla-poll" | "phone" | "ai" | "manual";

/** A source-agnostic location observation. The entire decoupling is this shape. */
export interface LocationFix {
  latitude: number;
  longitude: number;
  /** Epoch ms the fix was taken; defaults to now. */
  capturedAt?: number;
  source: LocationSource;
  /** Present only for Tesla sources; phone/ai/manual carry no gear. */
  shiftState?: "P" | "R" | "N" | "D" | null;
  speed?: number | null;
  headingDeg?: number | null;
  accuracyMeters?: number | null;
  vin?: string | null;
  /** The thing being tracked: a vin, or "phone" / "ai". Defaults from source. */
  subjectId?: string;
  /** Raw upstream payload, for the receipts drawer. */
  raw?: unknown;
}

export interface IngestOptions {
  /**
   * Insert a `device_location` provenance row. Default true. Set false when the
   * caller already recorded the fix (the device-location route inserts its own).
   */
  record?: boolean;
  /**
   * Skip the home/work arrival check. Default false. Set true when the caller
   * already ran it, so a drive isn't double-ended.
   */
  skipHomeArrival?: boolean;
}

export interface IngestResult {
  source: LocationSource;
  recorded: boolean;
  deviceLocationId?: number;
  matched: boolean;
  homeEnded: boolean;
  homeReason?: string;
  staged: boolean;
  visitLogId?: number;
  storeId?: number;
  stageReason?: string;
}

/** LocationFix.source → the visit-log gps_source enum value. */
function toGpsSource(source: LocationSource): GpsSource {
  switch (source) {
    case "tesla-stream":
      return "tesla-telemetry";
    case "tesla-poll":
      return "tesla-poll";
    case "phone":
      return "phone";
    case "ai":
      return "ai";
    case "manual":
      return "manual";
  }
}

/** LocationFix.source → the (narrower) home-arrival source enum. */
function toHomeSource(source: LocationSource): "tesla-webhook" | "tesla-telemetry" | "device" {
  if (source === "tesla-stream") return "tesla-telemetry";
  if (source === "tesla-poll") return "tesla-webhook";
  return "device";
}

/** device_location.source value for a discrete source (free-text column). */
function toDeviceSource(source: LocationSource): string {
  return source === "ai" ? "ai" : source === "manual" ? "manual" : "phone";
}

/**
 * Ingest one location fix: record provenance, then run the park pipeline
 * (match a stop → home/work check → stage a soft arrival near a showroom on the
 * active drive). Idempotent-friendly: `matchAndMarkVisited`, the home check, and
 * `stageSoftArrival`'s dedup all tolerate being called repeatedly for the same
 * park, so a level-triggered source (a phone that pings every minute while parked)
 * won't stack drafts. Never auto-navigates — commanding the car stays with the
 * stream DO / poller, so a stray phone ping can't send the car anywhere.
 */
export async function ingestLocationFix(
  env: Env,
  fix: LocationFix,
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const db = drizzle(env.DB);
  const result: IngestResult = {
    source: fix.source,
    recorded: false,
    matched: false,
    homeEnded: false,
    staged: false,
  };

  // 1. Provenance — reuse the device_location sink for discrete sources. The
  //    Tesla sources record their own telemetry/poll evidence upstream.
  if (opts.record !== false && (fix.source === "phone" || fix.source === "ai" || fix.source === "manual")) {
    const [row] = await db
      .insert(deviceLocation)
      .values({
        source: toDeviceSource(fix.source),
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracyMeters: fix.accuracyMeters ?? null,
      })
      .returning({ id: deviceLocation.id });
    result.recorded = true;
    result.deviceLocationId = row?.id;
  }

  // 2. Check off a stop on the active drive if we're on top of one (no auto-nav).
  try {
    const match = await matchAndMarkVisited(db, { lat: fix.latitude, lng: fix.longitude });
    result.matched = match.matched != null;
  } catch (err) {
    console.error("[location/ingest] matchAndMarkVisited failed:", err);
  }

  // 3. Home/work arrival ends the active drive (a discrete report is stationary).
  let homeCheckFailed = false;
  if (!opts.skipHomeArrival) {
    try {
      const home = await maybeEndActiveDriveOnHomeArrival(env, {
        latitude: fix.latitude,
        longitude: fix.longitude,
        // A non-finite/absent capturedAt must not become an Invalid Date.
        at:
          fix.capturedAt != null && Number.isFinite(fix.capturedAt)
            ? new Date(fix.capturedAt)
            : undefined,
        source: toHomeSource(fix.source),
        stopped: true,
      });
      result.homeEnded = home.ended;
      result.homeReason = home.reason;
    } catch (err) {
      console.error("[location/ingest] home-arrival check failed:", err);
      homeCheckFailed = true;
    }
  }

  // 4. Not home → stage a soft arrival if near a registered showroom on the drive.
  //    Fail SAFE: if the home check threw we can't be sure this isn't home, so we
  //    do NOT stage (better a missed stage than a soft arrival logged at home).
  if (!result.homeEnded && !homeCheckFailed) {
    try {
      const stage = await stageSoftArrival(env, {
        latitude: fix.latitude,
        longitude: fix.longitude,
        gpsSource: toGpsSource(fix.source),
      });
      result.staged = stage.staged;
      result.visitLogId = stage.visitLogId;
      result.storeId = stage.storeId;
      result.stageReason = stage.reason;
    } catch (err) {
      console.error("[location/ingest] stageSoftArrival failed:", err);
    }
  }

  return result;
}
