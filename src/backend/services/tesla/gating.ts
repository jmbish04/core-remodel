/**
 * @fileoverview Tesla ingest LIFECYCLE gating (0023 ING-03).
 *
 * The streaming connector (`TeslaStreamDO`, PR2) is duration-billed the whole
 * time it holds the outbound Tessie socket, so it must only be alive when it
 * earns its keep. This module is the single decision surface for "should the
 * stream be connected right now?" and "should the poller run instead?", so the
 * DO, the control routes, and the scheduled tick all agree.
 *
 * The rules (operator's spec):
 *   - The stream is alive only when ALL hold: a drive list is ACTIVE, the local
 *     time is inside the daytime WINDOW (default 07:00–20:00 Pacific), telemetry
 *     recording is on, and the UI TOGGLE is on.
 *   - A drive list may only be ACTIVATED inside the window, and an active drive
 *     is auto-deactivated once the window closes — "a drive list can only be
 *     active 7am–8pm".
 *   - If the toggle is OFF (or the socket isn't actually connected) while a drive
 *     is still active, the cheaper cron POLLER runs instead, every N seconds.
 *
 * Config lives in `project_system_variables` (same store as the recording-consent
 * flag and the circuit breaker), written through the sanctioned `setConfigValue`.
 */
import { projectSystemVariables } from "@backend/db";
import { getActiveDriveSlug, setActiveDrive } from "@backend/services/drive-lists";
import { telemetryRecordingAllowed } from "@backend/services/tesla-integration";
import { setConfigValue } from "@backend/services/usage/metering";
import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

/** Timezone the daytime window is expressed in — the house is in the Bay Area. */
export const STREAM_WINDOW_TZ = "America/Los_Angeles";

export const STREAM_ENABLED_KEY = "tesla_stream_enabled";
export const STREAM_WINDOW_START_KEY = "tesla_stream_window_start_hour";
export const STREAM_WINDOW_END_KEY = "tesla_stream_window_end_hour";
export const STREAM_POLL_FALLBACK_KEY = "tesla_stream_poll_fallback_seconds";
/** Runtime flag the DO sets while its socket is up, so the poller stands down. */
export const STREAM_CONNECTED_KEY = "tesla_stream_connected";
/** Epoch-ms heartbeat the DO refreshes while connected — makes `connected` stale-proof. */
export const STREAM_CONNECTED_AT_KEY = "tesla_stream_connected_at";

/**
 * Floor for the poller cadence. Cloudflare KV rejects an `expirationTtl` below 60s,
 * and the master tick is per-minute anyway, so a sub-60s cadence is both impossible
 * to honor and rejected by the throttle store.
 */
export const MIN_POLL_FALLBACK_SECONDS = 60;

/**
 * A `connected` flag older than this is treated as STALE (the DO crashed without
 * clearing it), so the poller resumes rather than standing down forever. The DO
 * refreshes the heartbeat well inside this on every alarm.
 */
export const STREAM_CONNECTED_STALE_MS = 5 * 60_000;

/** Defaults — an install with no rows behaves as: toggle on, 07:00–20:00, 120s poll. */
const DEFAULTS = {
  enabled: true,
  windowStartHour: 7,
  windowEndHour: 20,
  pollFallbackSeconds: 120,
} as const;

export interface StreamControl {
  /** UI toggle — when off, the DO does not connect and the poller takes over. */
  enabled: boolean;
  /** Inclusive local hour the window opens (0–23). */
  windowStartHour: number;
  /** Exclusive local hour the window closes (1–24). */
  windowEndHour: number;
  /** Poller cadence when it is the active ingest path. */
  pollFallbackSeconds: number;
  /** Whether the DO currently reports its socket connected. */
  connected: boolean;
}

function toIntInRange(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw == null ? NaN : parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

/** Read the full stream-control config in ONE query, with defaults for missing rows. */
export async function getStreamControl(env: Env): Promise<StreamControl> {
  const rows = await drizzle(env.DB)
    .select({ key: projectSystemVariables.variableKey, value: projectSystemVariables.valueText })
    .from(projectSystemVariables)
    .where(
      inArray(projectSystemVariables.variableKey, [
        STREAM_ENABLED_KEY,
        STREAM_WINDOW_START_KEY,
        STREAM_WINDOW_END_KEY,
        STREAM_POLL_FALLBACK_KEY,
        STREAM_CONNECTED_KEY,
        STREAM_CONNECTED_AT_KEY,
      ]),
    );
  const map = new Map(rows.map((r) => [r.key, r.value ?? null]));
  const enabled = map.get(STREAM_ENABLED_KEY) ?? null;
  const start = map.get(STREAM_WINDOW_START_KEY) ?? null;
  const end = map.get(STREAM_WINDOW_END_KEY) ?? null;
  const poll = map.get(STREAM_POLL_FALLBACK_KEY) ?? null;
  const connectedFlag = map.get(STREAM_CONNECTED_KEY) ?? null;
  const connectedAt = map.get(STREAM_CONNECTED_AT_KEY) ?? null;
  const rawStart = toIntInRange(start, DEFAULTS.windowStartHour, 0, 23);
  const rawEnd = toIntInRange(end, DEFAULTS.windowEndHour, 1, 24);
  // Guard against an inverted window. The two hours are independent rows, so a
  // partial write (only the start key present) or a hand edit can leave end ≤
  // start — which would make isWithinStreamWindow() false for EVERY hour and
  // silently kill all streaming AND polling. When inverted, fall back to BOTH
  // defaults so the returned window is always coherent.
  let windowStartHour = rawStart;
  let windowEndHour = rawEnd;
  if (windowEndHour <= windowStartHour) {
    windowStartHour = DEFAULTS.windowStartHour;
    windowEndHour = DEFAULTS.windowEndHour;
  }
  // `connected` is only trusted when its heartbeat is fresh — a stale flag (DO
  // crashed without clearing it) degrades to false so the poller resumes.
  const connectedAtMs = connectedAt == null ? NaN : parseInt(connectedAt, 10);
  const connectedFresh =
    Number.isFinite(connectedAtMs) && Date.now() - connectedAtMs < STREAM_CONNECTED_STALE_MS;
  return {
    enabled: enabled == null ? DEFAULTS.enabled : enabled === "true",
    windowStartHour,
    windowEndHour,
    pollFallbackSeconds: toIntInRange(
      poll,
      DEFAULTS.pollFallbackSeconds,
      MIN_POLL_FALLBACK_SECONDS,
      3600,
    ),
    connected: connectedFlag === "true" && connectedFresh,
  };
}

/** The UI toggle. Off → DO disconnects and the poller becomes the ingest path. */
export async function setStreamEnabled(env: Env, enabled: boolean): Promise<void> {
  await setConfigValue(env, STREAM_ENABLED_KEY, enabled ? "true" : "false");
}

/** Set the daytime window (validated, start < end). */
export async function setStreamWindow(
  env: Env,
  startHour: number,
  endHour: number,
): Promise<void> {
  const s = toIntInRange(String(startHour), DEFAULTS.windowStartHour, 0, 23);
  const e = toIntInRange(String(endHour), DEFAULTS.windowEndHour, 1, 24);
  if (e <= s) throw new Error("Window end hour must be after the start hour.");
  await setConfigValue(env, STREAM_WINDOW_START_KEY, String(s));
  await setConfigValue(env, STREAM_WINDOW_END_KEY, String(e));
}

/** Set the poller fallback cadence (seconds). Floored at the KV/cron minimum. */
export async function setPollFallbackSeconds(env: Env, seconds: number): Promise<void> {
  const n = toIntInRange(String(seconds), DEFAULTS.pollFallbackSeconds, MIN_POLL_FALLBACK_SECONDS, 3600);
  await setConfigValue(env, STREAM_POLL_FALLBACK_KEY, String(n));
}

/**
 * Runtime connected flag, written by the DO on connect/disconnect. It is only a
 * hint for the poller stand-down — never a source of truth for billing safety
 * (the DO's own lifecycle + circuit breaker own that). When set true it stamps a
 * heartbeat so a stale flag (crashed DO) degrades to "not connected".
 */
export async function setStreamConnected(env: Env, connected: boolean): Promise<void> {
  if (connected) {
    // Stamp the heartbeat first, so a reader never sees connected=true with no time.
    await setConfigValue(env, STREAM_CONNECTED_AT_KEY, String(Date.now()));
    await setConfigValue(env, STREAM_CONNECTED_KEY, "true");
  } else {
    await setConfigValue(env, STREAM_CONNECTED_KEY, "false");
  }
}

/**
 * Refresh the connected heartbeat — called by the DO on every alarm while its
 * socket is up, so `getStreamControl().connected` stays fresh (and thus trusted)
 * for the poller stand-down.
 */
export async function heartbeatStream(env: Env): Promise<void> {
  await setConfigValue(env, STREAM_CONNECTED_AT_KEY, String(Date.now()));
}

/**
 * Is `when` inside the daytime window, in Pacific local time? Uses Intl so DST is
 * handled correctly (the worker runs in UTC). Window is [start, end).
 */
export function isWithinStreamWindow(when: Date, control: Pick<StreamControl, "windowStartHour" | "windowEndHour">): boolean {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone: STREAM_WINDOW_TZ,
    hour: "numeric",
    hour12: false,
  }).format(when);
  // Intl can render midnight as "24"; normalize to 0.
  const localHour = parseInt(hourStr, 10) % 24;
  return localHour >= control.windowStartHour && localHour < control.windowEndHour;
}

/** Whether a drive list is currently active (single-active invariant). */
async function hasActiveDrive(env: Env): Promise<boolean> {
  return (await getActiveDriveSlug(drizzle(env.DB))) != null;
}

/**
 * Should the streaming DO be CONNECTED right now? All four gates must pass:
 * recording allowed (configured + consent), toggle on, inside the window, and a
 * drive is active. This is the connect predicate for the DO and the start route.
 */
export async function shouldStreamNow(env: Env): Promise<boolean> {
  const [recording, control, active] = await Promise.all([
    telemetryRecordingAllowed(env),
    getStreamControl(env),
    hasActiveDrive(env),
  ]);
  return recording && control.enabled && active && isWithinStreamWindow(new Date(), control);
}

/**
 * Should the POLLER run this tick? It is the fallback ingest path: a drive is
 * active and recording is allowed, but the stream is NOT carrying the load —
 * either the toggle is off, we're outside the window, or the socket isn't up.
 * Gap-free by construction: exactly one of stream/poll covers an active drive.
 */
export async function shouldPollNow(env: Env): Promise<boolean> {
  const [recording, control, active] = await Promise.all([
    telemetryRecordingAllowed(env),
    getStreamControl(env),
    hasActiveDrive(env),
  ]);
  if (!recording || !active) return false;
  const streamCarrying =
    control.enabled && control.connected && isWithinStreamWindow(new Date(), control);
  return !streamCarrying;
}

export interface WindowEnforcement {
  /** True when an active drive was deactivated because the window had closed. */
  deactivated: boolean;
  /** The slug that was deactivated, when one was. */
  slug: string | null;
}

/**
 * Enforce "a drive can only be active 07:00–20:00": if a drive is active while
 * the local time is OUTSIDE the window, deactivate it (which also lets the DO and
 * the poller both stand down). Cheap — one indexed read, and a write only on the
 * rare boundary tick. Safe to call every minute from the scheduled handler.
 */
export async function enforceStreamWindow(env: Env): Promise<WindowEnforcement> {
  const db = drizzle(env.DB);
  const slug = await getActiveDriveSlug(db);
  if (!slug) return { deactivated: false, slug: null };
  const control = await getStreamControl(env);
  if (isWithinStreamWindow(new Date(), control)) return { deactivated: false, slug: null };
  await setActiveDrive(db, null);

  // Proactively stop the streaming DO too. Deactivating the drive already makes
  // shouldStreamNow() false, but the DO would otherwise keep holding its
  // duration-billed outbound Tessie socket until its NEXT alarm re-checks —
  // dropping it here closes that billing gap at the 20:00 window boundary.
  try {
    const stub = env.TESLA_STREAM.get(env.TESLA_STREAM.idFromName("singleton"));
    await stub.fetch("https://do/stop", { method: "POST" }).then((r) => r.body?.cancel());
  } catch (err) {
    console.error("[gating] tesla stream stop on window-close failed:", err);
  }

  return { deactivated: true, slug };
}
