/**
 * @fileoverview The health-probe contract shared by every module's `health.ts`.
 *
 * A module owns its own checks: each backend module exports a `HEALTH_PROBES`
 * array of `HealthProbe` from a `health.ts` sitting inside that module. The
 * registry (`services/health/registry.ts`) concatenates them; the runner
 * (`services/health/run.ts`) executes them and persists one `health_results`
 * row per probe per session.
 *
 * The probe object is BOTH the executable check and its documentation: the
 * literal fields on it are what get upserted into `health_test_def`, so the
 * runbook a human reads on `/admin/health` is generated from the same object
 * that ran the test. There is no second place to keep in sync.
 *
 * Cost discipline (this is a Cloudflare Worker and every probe runs on demand):
 * a probe must be BOUNDED and CHEAP. Read a binding, run a `SELECT`, count a
 * table. Never invoke a paid model, never crawl, never fan out. Probes that
 * WATCH cost (sudden spend jumps) set `isBillingRisk: true`.
 */

/** Severity of the thing being checked, not of the current outcome. */
export const HEALTH_SEVERITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type HealthSeverity = (typeof HEALTH_SEVERITIES)[number];

/** Outcome of one probe run. DEGRADED = working but outside its normal envelope. */
export const HEALTH_RESULTS = ["SUCCESS", "FAILURE", "DEGRADED"] as const;
export type HealthResult = (typeof HEALTH_RESULTS)[number];

export interface HealthProbeOutcome {
  result: HealthResult;
  /** Human-readable specifics: the numbers seen, the error, the thing missing. */
  details: string;
}

export interface HealthProbe {
  /** Stable snake_case id. Also the natural key of `health_test_def`. Never rename in place. */
  name: string;
  /** Pretty name for the dashboard. */
  displayName: string;
  /** What this test actually checks. */
  description: string;
  /** Repo path of the `health.ts` that owns this probe (for "where do I fix it"). */
  healthTsFilepath: string;
  /** Cloudflare binding types exercised, e.g. `["d1", "kv"]`. Seeds the binding-type vocabulary. */
  bindingTypesTested: string[];
  whatSuccessMeans: string;
  whatFailureMeans: string;
  troubleshootingSteps: string;
  devOpsPlaybook: string;
  /** True when the probe exists to catch a sudden jump in Cloudflare/AI spend. */
  isBillingRisk: boolean;
  severity: HealthSeverity;
  /**
   * Run the check. May throw — the runner converts a throw into FAILURE with the
   * error message as details, so a probe never sinks the session.
   */
  run: (env: Env) => Promise<HealthProbeOutcome>;
}

/** Identity helper so probe literals get checked at the definition site. */
export function defineProbe(probe: HealthProbe): HealthProbe {
  return probe;
}

export const ok = (details: string): HealthProbeOutcome => ({ result: "SUCCESS", details });
export const degraded = (details: string): HealthProbeOutcome => ({ result: "DEGRADED", details });
export const failure = (details: string): HealthProbeOutcome => ({ result: "FAILURE", details });

/**
 * Read a Secrets Store binding without throwing. Returns the value, or null when
 * the binding is absent or unreadable — callers decide whether that is FAILURE
 * (required credential) or DEGRADED (optional integration).
 */
export async function readSecret(
  secret: SecretsStoreSecret | undefined,
): Promise<string | null> {
  if (!secret) return null;
  try {
    const v = await secret.get();
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** SELECT one scalar out of D1 without dragging drizzle in for a counter. */
export async function scalar(db: D1Database, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await db
    .prepare(sql)
    .bind(...binds)
    .first<Record<string, unknown>>();
  if (!row) return 0;
  const v = Object.values(row)[0];
  return typeof v === "number" ? v : Number(v ?? 0);
}

/**
 * Does this table exist? Several probes count rows in tables that a not-yet-applied
 * migration may not have created; a missing table is a DEPLOY-ORDER fault worth
 * reporting distinctly from a bad count.
 */
export async function tableExists(db: D1Database, table: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .bind(table)
    .first();
  return Boolean(row);
}
