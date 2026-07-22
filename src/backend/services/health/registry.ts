/**
 * @fileoverview System health registry — one place every health check registers.
 *
 * The health page lists whatever is in HEALTH_CHECKS, so adding a check is a
 * one-file change and the page grows on its own. Without a registry each
 * vertical grows its own bespoke endpoint and the "how is the system doing"
 * question has no single answer.
 *
 * A check returns FACTS, not prose: a status, a headline metric, and the stats
 * that justify the status. The UI decides how to render them; the check decides
 * what is true.
 *
 * DEGRADED vs UNHEALTHY is a real distinction, not a severity gradient:
 *   healthy    nothing to do.
 *   degraded   real defects, system still functions — data is wrong or
 *              incomplete but nothing is broken. Brand duplicates live here:
 *              the app works, some brands show up twice.
 *   unhealthy  the check's subject cannot do its job.
 *   unknown    the check itself failed. NEVER report this as healthy — a check
 *              that throws tells you nothing, and silently passing is how a
 *              broken check hides a broken system.
 */

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface HealthStat {
  label: string;
  value: number | string;
  /** Marks the stat that CAUSED a non-healthy status, so the UI can highlight it. */
  problem?: boolean;
}

export interface HealthResult {
  status: HealthStatus;
  /** One line explaining the status, shown on the row. */
  summary: string;
  /** 0-100. The row's "quality" figure; also drives the global badge. */
  score: number;
  stats: HealthStat[];
  /** Optional deep link to where the problem is fixed. */
  actionUrl?: string;
  actionLabel?: string;
}

export interface HealthCheck {
  /** URL-safe id. Used for /admin/system/audit/:slug and logs/:slug. */
  slug: string;
  name: string;
  /** Product area, so the page can group as the system grows. */
  vertical: "brands" | "products" | "showrooms" | "research" | "platform";
  description: string;
  run: (env: Env) => Promise<HealthResult>;
}

/** Registered checks. Add one here and it appears on /admin/system/health. */
export const HEALTH_CHECKS: HealthCheck[] = [];

export function registerHealthCheck(check: HealthCheck): HealthCheck {
  if (HEALTH_CHECKS.some((c) => c.slug === check.slug)) {
    throw new Error(`duplicate health check slug: ${check.slug}`);
  }
  HEALTH_CHECKS.push(check);
  return check;
}

/**
 * Score from problem counts. Shared so every check grades on the same curve —
 * otherwise "82%" means something different on each row.
 *
 * Deliberately steep: 5 defects in a 400-row table is not 98.75% healthy in any
 * sense a human cares about. Each defect costs `weight` points.
 */
export function scoreFromDefects(defects: number, weight = 8): number {
  if (defects <= 0) return 100;
  return Math.max(0, Math.round(100 - defects * weight));
}

export function statusFromScore(score: number): HealthStatus {
  if (score >= 95) return "healthy";
  if (score >= 70) return "degraded";
  return "unhealthy";
}

/**
 * Run every registered check.
 *
 * A check that throws yields `unknown` with the error as its summary rather
 * than taking the whole page down — one broken check must not hide the status
 * of the others.
 */
export async function runAllHealthChecks(env: Env) {
  return Promise.all(
    HEALTH_CHECKS.map(async (check) => {
      try {
        const result = await check.run(env);
        return { ...describe(check), ...result };
      } catch (err) {
        return {
          ...describe(check),
          status: "unknown" as const,
          summary: `check failed: ${err instanceof Error ? err.message : String(err)}`,
          score: 0,
          stats: [],
        };
      }
    }),
  );
}

function describe(check: HealthCheck) {
  return {
    slug: check.slug,
    name: check.name,
    vertical: check.vertical,
    description: check.description,
    auditUrl: `/admin/system/audit/${check.slug}`,
    logsUrl: `/admin/system/logs/${check.slug}`,
  };
}

/**
 * Overall system figure for the global badge.
 *
 * The overall score is the MINIMUM, not the mean. Averaging lets one broken
 * subsystem hide behind a dozen healthy ones, which is exactly the failure the
 * badge exists to surface.
 */
export function aggregateHealth(
  results: Array<{ status: HealthStatus; score: number }>,
) {
  if (results.length === 0) {
    return { status: "unknown" as HealthStatus, score: 0, label: "No checks" };
  }
  const score = Math.min(...results.map((r) => r.score));
  const status: HealthStatus = results.some((r) => r.status === "unhealthy")
    ? "unhealthy"
    : results.some((r) => r.status === "unknown")
      ? "unknown"
      : results.some((r) => r.status === "degraded")
        ? "degraded"
        : "healthy";

  return { status, score, label: HEALTH_LABELS[status] };
}

/** Operator-facing wording for each status. */
export const HEALTH_LABELS: Record<HealthStatus, string> = {
  healthy: "High Performance",
  degraded: "Inconsistent / Gaps",
  unhealthy: "Degraded",
  unknown: "Unknown",
};
