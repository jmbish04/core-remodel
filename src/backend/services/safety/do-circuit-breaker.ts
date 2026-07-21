/**
 * @fileoverview Durable Object circuit breaker — the guard that makes a runaway
 * alarm loop STOP instead of billing into the thousands.
 *
 * WHY THIS EXISTS (the $700 incident, root cause commit 26b7607 / PR #162):
 * `RemodelOrchestrator` used the `@cloudflare/agents` SDK `this.schedule()`, which
 * is APPEND-ONLY — every call inserts a row into the SDK's internal
 * `cf_agents_schedules` table. It was re-armed unconditionally from `onStart()`
 * (fires on EVERY DO wake) and from `audit()`'s `finally`, so pending schedules
 * compounded: more rows -> more alarms -> more rows. The table reached ~1M rows and
 * every alarm full-scanned it, billing **537 BILLION Durable Object row reads in 30
 * days (~$512, and climbing)**. The cost driver was DO-SQLite *rows read* from an
 * unbounded, self-multiplying schedule table — not wall-clock, not writes.
 *
 * DESIGN LAW (enforced by scripts/check-do-alarms.mjs): new alarm-bearing DOs use
 * native `ctx.storage.setAlarm()` (a DO has exactly ONE alarm slot; setAlarm
 * REPLACES, it cannot append or grow a table), NEVER the Agents SDK `this.schedule()`.
 *
 * This module is the second line of defence: even a correct DO can go wrong (a
 * dependency change, a bad deploy). On EVERY alarm fire, an alarm-bearing DO calls
 * the cheap self-checks here and, on any runaway signal, TRIPS — deletes its alarm,
 * flips a global kill-switch, and refuses to run until a human clears it. The app
 * may go down; that is explicitly acceptable over runaway billing.
 *
 * The checks are deliberately cheap (a SARGABLE count, an O(1) window compare, a
 * single-row read) so the guard itself never becomes the cost — the same lesson the
 * Google Maps quota guard already applies to its month-count query.
 */

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { projectSystemVariables } from "@backend/db";

/** `project_system_variables` key holding the global kill-switch (JSON valueText). */
export const CB_VARIABLE_KEY = "do_circuit_breaker_tripped";

/**
 * Max pending rows for a single callback in an Agents-SDK DO's `cf_agents_schedules`
 * table. A healthy DO keeps at most ONE. Anything above this small bound is the
 * exact #162 signature (the table growing without limit) — trip immediately.
 */
export const SCHEDULE_TABLE_BOUND = 50;

/** Default fire-rate window: how many fires within `windowMs` is "runaway". */
export const DEFAULT_FIRE_WINDOW_MS = 60_000;
export const DEFAULT_MAX_FIRES = 6;

const CB_DESCRIPTION =
  "Global Durable Object circuit breaker. When tripped, alarm-bearing DOs delete " +
  "their alarm and refuse to run — a hard stop that trades availability for billing " +
  "safety after a runaway-alarm signal. Cleared by an admin from /admin/integrations/usage.";

/** The persisted kill-switch state. `tripped:false` (or absent row) = healthy. */
export interface CircuitBreakerState {
  tripped: boolean;
  /** Human-readable reason the breaker tripped. */
  reason?: string;
  /** Which DO tripped it. */
  doName?: string;
  /** Epoch ms of the trip (or the clear). */
  at?: number;
}

/**
 * Read the global kill-switch from D1. Returns `{ tripped: false }` when the row is
 * absent or unparseable — a missing switch is a healthy switch, never a fail-closed.
 *
 * @param dbBinding the `env.DB` D1 binding (drizzle is applied internally).
 */
export async function readCircuitBreaker(dbBinding: D1Database): Promise<CircuitBreakerState> {
  const db = drizzle(dbBinding);
  const [row] = await db
    .select({ valueText: projectSystemVariables.valueText })
    .from(projectSystemVariables)
    .where(eq(projectSystemVariables.variableKey, CB_VARIABLE_KEY))
    .limit(1);
  if (!row) return { tripped: false };
  try {
    const parsed = JSON.parse(row.valueText) as CircuitBreakerState;
    return { ...parsed, tripped: Boolean(parsed.tripped) };
  } catch {
    // Legacy/plain value — treat only the literal "true" as tripped.
    return { tripped: row.valueText === "true" };
  }
}

/** Upsert the kill-switch row with the given JSON state. */
async function writeCircuitBreaker(dbBinding: D1Database, state: CircuitBreakerState): Promise<void> {
  const db = drizzle(dbBinding);
  const valueText = JSON.stringify(state);
  await db
    .insert(projectSystemVariables)
    .values({
      variableKey: CB_VARIABLE_KEY,
      valueText,
      category: "safety",
      description: CB_DESCRIPTION,
      mappingRefKey: CB_VARIABLE_KEY,
    })
    .onConflictDoUpdate({
      target: projectSystemVariables.variableKey,
      set: { valueText },
    });
}

/**
 * TRIP the breaker: flip the global kill-switch. The caller is responsible for the
 * immediate local hard-stop (delete its alarm, return without rescheduling) — this
 * only records the durable, cross-DO state so every alarm-bearing DO refuses to run
 * on its next wake.
 */
export async function tripCircuitBreaker(
  dbBinding: D1Database,
  doName: string,
  reason: string,
): Promise<void> {
  await writeCircuitBreaker(dbBinding, { tripped: true, reason, doName, at: Date.now() });
  console.error(`[do-circuit-breaker] TRIPPED by ${doName}: ${reason}`);
}

/** Clear the breaker (admin action). Alarm-bearing DOs resume on their next wake. */
export async function clearCircuitBreaker(dbBinding: D1Database): Promise<void> {
  await writeCircuitBreaker(dbBinding, { tripped: false, at: Date.now() });
  console.warn("[do-circuit-breaker] cleared — alarm DOs may resume.");
}

/** Rolling fire-count window persisted by each DO (in its own storage/SQLite). */
export interface FireWindow {
  /** Epoch ms the current window opened. */
  windowStart: number;
  /** Fires observed since `windowStart`. */
  count: number;
}

export interface FireRateOptions {
  windowMs?: number;
  maxFires?: number;
}

/**
 * PURE fire-rate evaluation — storage-agnostic so it works identically whether the
 * caller persists the window in Agents-SDK `this.sql`, a plain DO's
 * `ctx.storage`, or memory. The caller reads `prev`, calls this, then persists the
 * returned `window`. Trips when the count in the current window exceeds `maxFires`.
 *
 * A window older than `windowMs` resets to a fresh window of count 1 (this fire).
 */
export function evaluateFireWindow(
  prev: FireWindow | null,
  nowMs: number,
  opts: FireRateOptions = {},
): { window: FireWindow; fires: number; tripped: boolean } {
  const windowMs = opts.windowMs ?? DEFAULT_FIRE_WINDOW_MS;
  const maxFires = opts.maxFires ?? DEFAULT_MAX_FIRES;
  const window: FireWindow =
    !prev || nowMs - prev.windowStart >= windowMs
      ? { windowStart: nowMs, count: 1 }
      : { windowStart: prev.windowStart, count: prev.count + 1 };
  return { window, fires: window.count, tripped: window.count > maxFires };
}

/** True when a callback's pending-schedule count is past the safe bound (#162). */
export function scheduleTableExceeded(count: number, bound: number = SCHEDULE_TABLE_BOUND): boolean {
  return count > bound;
}
