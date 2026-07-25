/**
 * @fileoverview Shared Tessie telemetry frame extractors.
 *
 * Lifted out of `api/routes/tesla.ts` (0023 ING-01) so the SAME parsing feeds
 * every ingest path — the webhook/telemetry compat routes today, and the
 * `TeslaStreamDO` outbound-WebSocket connector next — instead of each re-deriving
 * "where is the car / what gear / how fast" from a loosely-typed frame.
 *
 * Everything here is total and forgiving: an unexpected frame shape yields nulls,
 * never a throw, because a streaming connector cannot afford to die on one odd
 * frame mid-drive.
 */

/**
 * Pull `{latitude, longitude}` out of a loosely-typed webhook/telemetry payload.
 * Handles the common Tessie shapes: top-level `latitude`/`longitude`, a nested
 * `drive_state`, or a `location` object. Returns null when none is present.
 */
export function extractCoord(
  payload: Record<string, unknown>,
): { latitude: number; longitude: number } | null {
  const candidates: unknown[] = [
    payload,
    payload.drive_state,
    payload.location,
    (payload.data as Record<string, unknown> | undefined)?.drive_state,
  ];
  for (const c of candidates) {
    if (!c || typeof c !== "object") continue;
    const obj = c as Record<string, unknown>;
    const lat = obj.latitude ?? obj.lat;
    const lng = obj.longitude ?? obj.lng ?? obj.long;
    // Number.isFinite rejects NaN/Infinity, which `typeof === "number"` would let
    // through as bogus coordinates.
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { latitude: lat as number, longitude: lng as number };
    }
  }
  return null;
}

/** Extracted, typed telemetry fields (all nullable). */
export interface TelemetryFields {
  vin: string | null;
  eventTs: Date | null;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  shiftState: string | null;
  batteryLevel: number | null;
  odometer: number | null;
}

/**
 * Hoist the common fields out of a Fleet Telemetry frame, forgiving of shape.
 *
 * Tessie hosted telemetry frames come either flat (`{ vin, latitude, speed, … }`)
 * or as a `data: [{ key, value }]` array (Tesla Fleet Telemetry's native form).
 * We flatten the key/value array into a lookup and read from it OR the top level.
 * Anything absent stays null — this never throws on an unexpected frame.
 */
export function extractTelemetryFields(payload: Record<string, unknown>): TelemetryFields {
  // Flatten a `data: [{key,value}]` array into a lookup, if present. Uses a
  // null-prototype object so a hostile frame carrying `key: "__proto__"` can't
  // pollute Object.prototype for the isolate.
  const kv: Record<string, unknown> = Object.create(null);
  if (Array.isArray(payload.data)) {
    for (const item of payload.data) {
      if (item && typeof item === "object" && "key" in item) {
        kv[String((item as { key: unknown }).key)] = (item as { value?: unknown }).value;
      }
    }
  }
  const num = (...vals: unknown[]): number | null => {
    for (const v of vals) if (typeof v === "number" && Number.isFinite(v)) return v;
    return null;
  };
  const str = (...vals: unknown[]): string | null => {
    for (const v of vals) if (typeof v === "string" && v) return v;
    return null;
  };

  const loc = (kv.Location ?? payload.location) as Record<string, unknown> | undefined;
  const tsRaw = payload.createdAt ?? payload.timestamp ?? kv.Timestamp;
  // Normalize: a numeric timestamp under 1e10 is Unix SECONDS (Tesla/firmware
  // often sends seconds) — `new Date(seconds)` would land in 1970, so ×1000.
  let eventTs: Date | null = null;
  if (typeof tsRaw === "number") {
    eventTs = new Date(tsRaw < 1e10 ? tsRaw * 1000 : tsRaw);
  } else if (typeof tsRaw === "string") {
    // A numeric STRING ("1712345678") is a Unix timestamp too — new Date() would
    // reject it, so parse it with the same seconds-vs-ms heuristic; fall back to
    // Date parsing for an ISO string.
    const asNum = Number(tsRaw);
    eventTs =
      tsRaw.trim() !== "" && Number.isFinite(asNum)
        ? new Date(asNum < 1e10 ? asNum * 1000 : asNum)
        : new Date(tsRaw);
  }

  return {
    vin: str(payload.vin, kv.Vin),
    eventTs: eventTs && !Number.isNaN(eventTs.getTime()) ? eventTs : null,
    latitude: num(payload.latitude, loc?.latitude, kv.Latitude),
    longitude: num(payload.longitude, loc?.longitude, kv.Longitude),
    speed: num(payload.speed, kv.VehicleSpeed),
    shiftState: str(payload.shift_state, kv.Gear, kv.ShiftState),
    batteryLevel: num(payload.battery_level, kv.BatteryLevel, kv.Soc),
    odometer: num(payload.odometer, kv.Odometer),
  };
}
