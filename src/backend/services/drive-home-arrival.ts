/**
 * @fileoverview "You're home — the drive is over."
 *
 * A drive list stays active until something says the day ended, and the thing
 * that actually says it is the driver pulling into their own driveway. This
 * module owns that inference and nothing else: given a position fix — a Tesla
 * park event, or a phone/browser geolocation report — it decides whether to
 * clear the active drive slot (`setActiveDrive(db, null)`).
 *
 * ALL of these must hold, or nothing happens:
 *   1. A drive is currently active. (Otherwise there is nothing to end.)
 *   2. The fix is a STOPPED one — a park event, P gear, or a phone fix. Driving
 *      PAST the house at 4pm is not arriving home.
 *   3. The fix is within `HOME_RADIUS_M` of the project address.
 *   4. The local time (America/Los_Angeles) is at or after 15:30, any day of
 *      the week. Before that, coming home is a lunch break, not the end.
 *
 * The house coordinates come from the permit address already configured in
 * `project_system_variables` (`permits_target_address` / `_city` / `_zip`,
 * managed at /admin/config/address). They are geocoded ONCE via Places text
 * search and cached back into the same table as `home_latitude` /
 * `home_longitude`, so the steady state costs no Maps calls. If the address is
 * unset, or the lookup fails, this returns a reason and changes nothing —
 * never a guessed coordinate.
 */
import { projectSystemVariables } from "@backend/db";
import { GoogleMapsService } from "@backend/services/google/maps";
import { getPrimaryProperty } from "@backend/services/property";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  distanceMeters,
  homeArrivalReason,
  type HomeArrivalReason,
} from "./drive-home-arrival-rules";
import { getActiveDriveSlug, setActiveDrive } from "./drive-lists";

type RemodelDb = ReturnType<typeof drizzle>;

/** Where the house is. Cached in project_system_variables after the first lookup. */
const LAT_KEY = "home_latitude";
const LNG_KEY = "home_longitude";

export interface HomeArrivalInput {
  latitude: number;
  longitude: number;
  /** When the fix was taken. Defaults to now. */
  at?: Date;
  /** Where it came from — recorded in the result, not used in the decision. */
  source: "tesla-webhook" | "tesla-telemetry" | "device";
  /**
   * Whether the vehicle/device is STATIONARY at this fix. A phone report is
   * treated as stationary (the phone is wherever its owner is); a Tesla fix
   * must be a park event / P gear, or the car is merely driving past the house.
   */
  stopped: boolean;
}

export interface HomeArrivalResult {
  /** True only when this call actually cleared the active drive. */
  ended: boolean;
  /** Why it did or didn't — logged with the triggering event. */
  reason: HomeArrivalReason;
  /** Slug of the drive that was ended, when one was. */
  driveSlug?: string;
  /** Metres from the house, when the house position was known. */
  distanceM?: number;
}

/** Read a project_system_variables value, or null when unset. */
async function readVar(db: RemodelDb, key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: projectSystemVariables.valueText })
    .from(projectSystemVariables)
    .where(eq(projectSystemVariables.variableKey, key))
    .limit(1);
  return row?.value ?? null;
}

/** Upsert a project_system_variables row (both unique keys are set to `key`). */
async function writeVar(db: RemodelDb, key: string, value: string, description: string) {
  await db
    .insert(projectSystemVariables)
    .values({
      variableKey: key,
      valueText: value,
      category: "location",
      description,
      mappingRefKey: key,
    })
    .onConflictDoUpdate({ target: projectSystemVariables.variableKey, set: { valueText: value } });
}

/**
 * The project's coordinates — cached, else geocoded once from the configured
 * permit address. `null` when no address is configured or the lookup failed;
 * callers must treat that as "don't know", never as "not home".
 */
export async function getHomeCoords(
  env: Env,
  db: RemodelDb,
): Promise<{ latitude: number; longitude: number } | null> {
  const [latRaw, lngRaw] = await Promise.all([readVar(db, LAT_KEY), readVar(db, LNG_KEY)]);
  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (latRaw && lngRaw && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { latitude: lat, longitude: lng };
  }

  // Not cached — resolve the origin from the single property reader (the
  // `properties` table, else the legacy permit-config KV). If the table already
  // carries coordinates, trust them and skip the geocode entirely.
  const property = await getPrimaryProperty(db);
  if (!property) return null;
  if (property.latitude != null && property.longitude != null) {
    return { latitude: property.latitude, longitude: property.longitude };
  }
  const query = property.formattedAddress;
  if (!query) return null;

  try {
    const place = await new GoogleMapsService(env).placesTextSearch(query);
    if (place?.latitude == null || place.longitude == null) return null;
    await writeVar(db, LAT_KEY, String(place.latitude), `Latitude of ${query} (geocoded once).`);
    await writeVar(db, LNG_KEY, String(place.longitude), `Longitude of ${query} (geocoded once).`);
    return { latitude: place.latitude, longitude: place.longitude };
  } catch (e) {
    console.error("home coords lookup failed", e);
    return null;
  }
}

/**
 * End the active drive if this fix means the driver got home for the day.
 *
 * Safe to call on every position fix: it short-circuits on the cheap checks
 * (active drive → stopped → time) before it ever touches the Maps API, and it
 * only ever CLEARS the active slot — it never activates anything.
 */
export async function maybeEndActiveDriveOnHomeArrival(
  env: Env,
  input: HomeArrivalInput,
): Promise<HomeArrivalResult> {
  const db = drizzle(env.DB);

  const at = input.at ?? new Date();
  const activeSlug = await getActiveDriveSlug(db);

  // Cheap gates first — an inactive drive, a moving car, or a lunchtime fix all
  // decide the question before the (billable) home-coordinate lookup.
  const early = homeArrivalReason({
    hasActiveDrive: Boolean(activeSlug),
    stopped: input.stopped,
    at,
    distanceM: 0,
  });
  if (early !== "ended" || !activeSlug) return { ended: false, reason: early };

  const home = await getHomeCoords(env, db);
  const distanceM = home
    ? distanceMeters(home.latitude, home.longitude, input.latitude, input.longitude)
    : null;
  const reason = homeArrivalReason({ hasActiveDrive: true, stopped: true, at, distanceM });
  if (reason !== "ended") {
    return { ended: false, reason, ...(distanceM == null ? {} : { distanceM }) };
  }

  await setActiveDrive(db, null);
  console.log(
    `drive "${activeSlug}" deactivated — home arrival (${input.source}, ${Math.round(distanceM ?? 0)}m)`,
  );
  return { ended: true, reason: "ended", driveSlug: activeSlug, distanceM: distanceM ?? 0 };
}
