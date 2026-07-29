/**
 * @fileoverview Source-agnostic park/dwell detector (0032 L1).
 *
 * Turns a stream of `LocationFix`es for one subject into PARK / DRIVE-AWAY events,
 * with or without a gear:
 *   • shiftState present (Tesla poll/stream): edge-triggered — a transition INTO
 *     "P" is a park, "P" → moving is a drive-away. Instant.
 *   • shiftState absent (a phone/AI stream): a DWELL heuristic — successive fixes
 *     within PARK_RADIUS_M for ≥ DWELL_MIN is a park; moving > DEPART_RADIUS_M from
 *     the park anchor is a drive-away.
 *
 * Hot state lives in KV (`loc:detector:<subjectId>`) — self-replacing, never a
 * growing table (the $700-runaway lesson). A confirmed park also writes a
 * `park_sessions` row so an in-flight visit survives a worker eviction; the row is
 * settled on drive-away. Thresholds come from the Tesla-location config (C1 keys)
 * with sane defaults.
 *
 * Concurrency: state is keyed per subject. A single physical subject (a vin, a
 * phone) does not emit concurrent fixes in practice — the poller stands down while
 * the stream carries (existing gate), and a phone pings serially — so the KV
 * read-modify-write is safe without per-subject locking. Documented, per plan §11.
 */
import { parkSessions } from "@backend/db/schema/system/park-sessions";
import { projectSystemVariables } from "@backend/db/schema/home/project_system_variables";
import { haversineMeters } from "@backend/services/drive-geo-match";
import { and, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import type { LocationSource } from "./ingest";

const KV_PREFIX = "loc:detector:";
/** KV state TTL — a stale detector (no fix for this long) is safe to forget. */
const STATE_TTL_SECONDS = 24 * 60 * 60;

export interface DetectorConfig {
  dwellMinSeconds: number;
  parkRadiusM: number;
  departRadiusM: number;
  moveEpsM: number;
}

const DEFAULTS: DetectorConfig = {
  dwellMinSeconds: 300,
  parkRadiusM: 60,
  departRadiusM: 120,
  moveEpsM: 40,
};

export interface DetectorInput {
  subjectId: string;
  source: LocationSource;
  latitude: number;
  longitude: number;
  /** Epoch ms. */
  capturedAt: number;
  shiftState?: string | null;
  speed?: number | null;
}

export type DetectorEvent = "park" | "drive-away" | null;

export interface DetectorResult {
  event: DetectorEvent;
  /** The open/closed park_sessions row this fix acted on. */
  parkSessionId?: number;
  /** When the park began (epoch ms), on a park or drive-away event. */
  parkedAt?: number;
  /** Dwell in seconds, on a drive-away event. */
  dwellSeconds?: number;
}

/** Persisted detector state (KV). */
interface DetectorState {
  phase: "moving" | "settling" | "parked";
  /** Anchor point of the current settling/parked cluster. */
  anchorLat: number;
  anchorLng: number;
  /** When settling began (epoch ms) — the dwell clock. */
  settlingSinceMs: number;
  lastFixMs: number;
  lastShift: string | null;
  /** The open park_sessions row, once parked. */
  parkSessionId?: number;
}

/** Read the dwell/radius thresholds from config, falling back to defaults. */
async function readConfig(env: Env): Promise<DetectorConfig> {
  try {
    const db = drizzle(env.DB);
    const rows = await db
      .select({ k: projectSystemVariables.variableKey, v: projectSystemVariables.valueText })
      .from(projectSystemVariables)
      .where(
        inArray(projectSystemVariables.variableKey, [
          "loc_dwell_min_seconds",
          "loc_park_radius_m",
          "loc_depart_radius_m",
        ]),
      );
    const by = new Map(rows.map((r) => [r.k, r.v]));
    const num = (k: string, d: number) => {
      const n = Number(by.get(k));
      return Number.isFinite(n) && n > 0 ? n : d;
    };
    return {
      dwellMinSeconds: num("loc_dwell_min_seconds", DEFAULTS.dwellMinSeconds),
      parkRadiusM: num("loc_park_radius_m", DEFAULTS.parkRadiusM),
      departRadiusM: num("loc_depart_radius_m", DEFAULTS.departRadiusM),
      moveEpsM: DEFAULTS.moveEpsM,
    };
  } catch {
    return DEFAULTS;
  }
}

async function readState(env: Env, subjectId: string): Promise<DetectorState | null> {
  const raw = await env.CACHE.get(`${KV_PREFIX}${subjectId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DetectorState;
  } catch {
    return null;
  }
}

async function writeState(env: Env, subjectId: string, state: DetectorState): Promise<void> {
  await env.CACHE.put(`${KV_PREFIX}${subjectId}`, JSON.stringify(state), {
    expirationTtl: STATE_TTL_SECONDS,
  });
}

async function clearState(env: Env, subjectId: string): Promise<void> {
  await env.CACHE.delete(`${KV_PREFIX}${subjectId}`);
}

/** Is this fix "stopped"? Gear wins; else fall back to (near-)zero speed. */
function isStopped(input: DetectorInput): boolean {
  if (input.shiftState != null) return input.shiftState === "P";
  return input.speed == null || input.speed <= 1; // <=1 m/s ≈ standing still
}

/**
 * Process one fix for its subject. Returns the PARK / DRIVE-AWAY event (or null),
 * and maintains the KV state + the park_sessions anchor row. Idempotent-friendly:
 * a repeated fix while already parked returns null (no duplicate event).
 */
export async function processFix(env: Env, input: DetectorInput): Promise<DetectorResult> {
  const cfg = await readConfig(env);
  const prev = await readState(env, input.subjectId);
  const now = input.capturedAt;
  const stopped = isStopped(input);

  const movedFromAnchor = (s: DetectorState) =>
    haversineMeters(
      { lat: s.anchorLat, lng: s.anchorLng },
      { lat: input.latitude, lng: input.longitude },
    );

  // ── shiftState path (edge-triggered) — the precise Tesla case ──
  if (input.shiftState != null) {
    const wasShift = prev?.lastShift ?? null;
    const intoPark = input.shiftState === "P" && wasShift !== "P";
    const outOfPark = wasShift === "P" && input.shiftState !== "P";

    if (intoPark) {
      const parkSessionId = await openParkSession(env, input);
      await writeState(env, input.subjectId, {
        phase: "parked",
        anchorLat: input.latitude,
        anchorLng: input.longitude,
        settlingSinceMs: now,
        lastFixMs: now,
        lastShift: input.shiftState,
        parkSessionId,
      });
      return { event: "park", parkSessionId, parkedAt: now };
    }
    if (outOfPark) {
      const settle = prev?.parkSessionId
        ? await settleParkSession(env, prev.parkSessionId, now)
        : undefined;
      await clearState(env, input.subjectId);
      return { event: "drive-away", parkSessionId: prev?.parkSessionId, dwellSeconds: settle?.dwellSeconds };
    }
    // No transition — just remember the gear (and keep any open park).
    await writeState(env, input.subjectId, {
      phase: input.shiftState === "P" ? "parked" : "moving",
      anchorLat: prev?.anchorLat ?? input.latitude,
      anchorLng: prev?.anchorLng ?? input.longitude,
      settlingSinceMs: prev?.settlingSinceMs ?? now,
      lastFixMs: now,
      lastShift: input.shiftState,
      parkSessionId: prev?.parkSessionId,
    });
    return { event: null, parkSessionId: prev?.parkSessionId };
  }

  // ── dwell path (no gear) — phone / AI continuous stream ──
  if (!prev || prev.phase === "moving") {
    if (stopped) {
      // Begin settling from here.
      await writeState(env, input.subjectId, {
        phase: "settling",
        anchorLat: input.latitude,
        anchorLng: input.longitude,
        settlingSinceMs: now,
        lastFixMs: now,
        lastShift: null,
      });
    } else if (prev) {
      await writeState(env, input.subjectId, { ...prev, lastFixMs: now });
    }
    return { event: null };
  }

  if (prev.phase === "settling") {
    if (movedFromAnchor(prev) > cfg.parkRadiusM) {
      // Left before the dwell threshold — not a visit; re-anchor as moving.
      await writeState(env, input.subjectId, {
        phase: stopped ? "settling" : "moving",
        anchorLat: input.latitude,
        anchorLng: input.longitude,
        settlingSinceMs: now,
        lastFixMs: now,
        lastShift: null,
      });
      return { event: null };
    }
    if (now - prev.settlingSinceMs >= cfg.dwellMinSeconds * 1000) {
      const parkSessionId = await openParkSession(env, input);
      await writeState(env, input.subjectId, {
        ...prev,
        phase: "parked",
        lastFixMs: now,
        parkSessionId,
      });
      return { event: "park", parkSessionId, parkedAt: prev.settlingSinceMs };
    }
    await writeState(env, input.subjectId, { ...prev, lastFixMs: now });
    return { event: null };
  }

  // prev.phase === "parked"
  if (movedFromAnchor(prev) > cfg.departRadiusM) {
    const settle = prev.parkSessionId
      ? await settleParkSession(env, prev.parkSessionId, now)
      : undefined;
    await clearState(env, input.subjectId);
    return { event: "drive-away", parkSessionId: prev.parkSessionId, dwellSeconds: settle?.dwellSeconds };
  }
  await writeState(env, input.subjectId, { ...prev, lastFixMs: now });
  return { event: null, parkSessionId: prev.parkSessionId };
}

/**
 * Open (or reuse) the park_sessions anchor for this subject. Check-then-insert:
 * reuse an existing OPEN row (the "one open park per subject" invariant), else
 * insert. The partial-unique index is the DB backstop for a rare concurrent race;
 * if the insert trips it we re-read the winner rather than fail.
 */
async function openParkSession(env: Env, input: DetectorInput): Promise<number | undefined> {
  const db = drizzle(env.DB);
  try {
    const [existing] = await db
      .select({ id: parkSessions.id })
      .from(parkSessions)
      .where(and(eq(parkSessions.subjectId, input.subjectId), eq(parkSessions.status, "parked")))
      .limit(1);
    if (existing) return existing.id;

    const [row] = await db
      .insert(parkSessions)
      .values({
        subjectId: input.subjectId,
        source: input.source,
        latitude: input.latitude,
        longitude: input.longitude,
        parkedAt: new Date(input.capturedAt),
        status: "parked",
      })
      .returning({ id: parkSessions.id });
    return row?.id;
  } catch (err) {
    // A concurrent insert may have won the partial-unique race — re-read it.
    console.error("[park-detector] openParkSession insert race/err:", err);
    const [winner] = await db
      .select({ id: parkSessions.id })
      .from(parkSessions)
      .where(and(eq(parkSessions.subjectId, input.subjectId), eq(parkSessions.status, "parked")))
      .limit(1);
    return winner?.id;
  }
}

/** Close a park_sessions row on drive-away with departure + dwell. */
async function settleParkSession(
  env: Env,
  parkSessionId: number,
  departedAtMs: number,
): Promise<{ dwellSeconds: number } | undefined> {
  try {
    const db = drizzle(env.DB);
    const [open] = await db
      .select({ parkedAt: parkSessions.parkedAt })
      .from(parkSessions)
      .where(eq(parkSessions.id, parkSessionId))
      .limit(1);
    const parkedMs = open?.parkedAt ? open.parkedAt.getTime() : departedAtMs;
    const dwellSeconds = Math.max(0, Math.round((departedAtMs - parkedMs) / 1000));
    await db
      .update(parkSessions)
      .set({
        status: "settled",
        departedAt: new Date(departedAtMs),
        dwellSeconds,
        updatedAt: new Date(departedAtMs),
      })
      .where(eq(parkSessions.id, parkSessionId));
    return { dwellSeconds };
  } catch (err) {
    console.error("[park-detector] settleParkSession failed:", err);
    return undefined;
  }
}

/** Link a staged visit to its park session (best-effort). */
export async function linkVisitToParkSession(
  env: Env,
  parkSessionId: number,
  visitLogId: number,
  storeId?: number,
): Promise<void> {
  try {
    const db = drizzle(env.DB);
    await db
      .update(parkSessions)
      .set({ visitLogId, storeId: storeId ?? null, updatedAt: new Date() })
      .where(eq(parkSessions.id, parkSessionId));
  } catch (err) {
    console.error("[park-detector] linkVisitToParkSession failed:", err);
  }
}
