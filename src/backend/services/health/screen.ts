/**
 * @fileoverview On-demand health screen — actually exercises the worker's core
 * bindings (not just a table read) and records the outcome.
 *
 * The existing `GET /api/health` only pings D1 and re-reads the `health_checks`
 * table. This service is the "run the checks NOW" action behind the `/health`
 * page's button: it probes each binding with a real, cheap operation, times it,
 * writes one `health_checks` row per service, and returns the per-service results
 * plus an overall roll-up.
 *
 * Cost discipline: every probe is bounded and free — a `SELECT 1`, a KV
 * put/get of a tiny probe key, an R2 `head` of a sentinel, and a binding-presence
 * check for Workers AI (running an actual model costs money, so we do NOT). No
 * probe throws out of here; a failure becomes a `down`/`degraded` result.
 */

import { healthChecks } from "@backend/db";
import { drizzle } from "drizzle-orm/d1";

export type HealthStatus = "healthy" | "degraded" | "down";

export interface HealthCheckResult {
  serviceName: string;
  status: HealthStatus;
  /** Probe latency in ms (null when the check is instantaneous/binding-only). */
  responseTime: number | null;
  errorMessage: string | null;
}

export interface HealthScreenResult {
  status: HealthStatus;
  timestamp: string;
  /** Total wall-clock of the whole screen, ms. */
  responseTime: number;
  checks: HealthCheckResult[];
}

/** Run `fn`, returning success + elapsed ms, converting a throw into an error string. */
async function timed(fn: () => Promise<void>): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t0 = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

function result(
  serviceName: string,
  r: { ok: boolean; ms: number; error?: string },
): HealthCheckResult {
  return {
    serviceName,
    status: r.ok ? "healthy" : "down",
    responseTime: r.ms,
    errorMessage: r.error ?? null,
  };
}

/** D1 reachability — a trivial `SELECT 1` round-trip. */
async function checkD1(binding: D1Database, serviceName: string): Promise<HealthCheckResult> {
  return result(
    serviceName,
    await timed(async () => {
      await binding.prepare("SELECT 1").first();
    }),
  );
}

/** KV reachability — write a short-TTL probe and read it back. */
async function checkKV(env: Env): Promise<HealthCheckResult> {
  const key = "health:probe";
  return result(
    "kv_cache",
    await timed(async () => {
      await env.CACHE.put(key, "1", { expirationTtl: 60 });
      const v = await env.CACHE.get(key);
      if (v !== "1") throw new Error("KV read-after-write mismatch");
    }),
  );
}

/** R2 reachability — `head` a sentinel key (a missing object returns null, not a throw). */
async function checkR2(env: Env): Promise<HealthCheckResult> {
  return result(
    "r2_artifacts",
    await timed(async () => {
      await env.ARTIFACTS_BUCKET.head("health/__probe__");
    }),
  );
}

/** Workers AI — binding presence only; running a model would incur cost. */
function checkAI(env: Env): HealthCheckResult {
  const present = Boolean(env.AI);
  return {
    serviceName: "workers_ai",
    status: present ? "healthy" : "down",
    responseTime: null,
    errorMessage: present ? null : "AI binding is not available",
  };
}

/** Roll several statuses up: any down → down; else any degraded → degraded; else healthy. */
function rollUp(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("down")) return "down";
  if (statuses.includes("degraded")) return "degraded";
  return "healthy";
}

/**
 * Run the full screen: probe every binding in parallel, persist one row per
 * service to `health_checks`, and return the results + overall status. Never
 * throws for an individual probe failure; only a failure to PERSIST is surfaced
 * (the checks themselves are still returned).
 */
export async function runHealthScreen(env: Env): Promise<HealthScreenResult> {
  const t0 = Date.now();

  const checks = await Promise.all([
    checkD1(env.DB, "database"),
    checkD1(env.TESLA_DB, "tesla_database"),
    checkKV(env),
    checkR2(env),
    Promise.resolve(checkAI(env)),
  ]);

  const overall = rollUp(checks.map((c) => c.status));

  // Persist one row per service. D1 has no transactions — use batch() (all-or-
  // nothing), and never db.transaction(). A persistence failure must not sink the
  // screen: the live results are still useful even if the audit trail write fails.
  try {
    const db = drizzle(env.DB);
    const stmts = checks.map((c) =>
      db.insert(healthChecks).values({
        serviceName: c.serviceName,
        status: c.status,
        responseTime: c.responseTime,
        errorMessage: c.errorMessage,
        timestamp: new Date(),
      }),
    );
    if (stmts.length > 0) {
      await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
    }
  } catch (e) {
    console.error("[health/screen] failed to persist health_checks rows:", e);
  }

  return {
    status: overall,
    timestamp: new Date().toISOString(),
    responseTime: Date.now() - t0,
    checks,
  };
}
