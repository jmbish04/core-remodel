/**
 * @fileoverview Agent run ledger retention.
 *
 * The ledger is append-only and every instrumented surface writes to it, so it
 * grows without bound — image processing alone writes one run per uploaded
 * photo. Left alone this becomes the next D1 row-read cost story, which would
 * be a particularly stupid way for a cost-monitoring feature to fail.
 *
 * Policy:
 *   - `succeeded` / `cancelled` runs are pruned after 30 days. Once a run has
 *     worked, its value is aggregate (throughput, spend), and the aggregate is
 *     already in `gemini_usage_log`.
 *   - `failed` / `needs_approval` runs are kept 90 days. Failures are the whole
 *     point of the ledger and are the thing a human comes back to weeks later.
 *   - Steps and tool calls are removed by the schema's ON DELETE CASCADE, so
 *     only the parent rows are deleted here.
 *
 * Runs on the daily cron rather than the per-minute tick: a sweep that finds
 * nothing 1,439 times a day is pure waste, and the ledger does not need
 * minute-resolution pruning.
 */
import { agentRuns } from "@backend/db";
import { and, inArray, isNull, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

/** Terminal-and-boring: safe to forget relatively soon. */
const SHORT_RETENTION_STATUSES = ["succeeded", "cancelled"] as const;
/** Terminal-and-interesting: a human may still need to read this. */
const LONG_RETENTION_STATUSES = ["failed", "needs_approval"] as const;

export const SHORT_RETENTION_DAYS = 30;
export const LONG_RETENTION_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface RetentionResult {
  shortDeleted: number;
  longDeleted: number;
}

/**
 * Prune aged runs. Never throws — a retention failure must not take down the
 * cron tick that also runs permit sync.
 *
 * `queued` and `running` are deliberately never pruned by age: a run stuck in
 * `running` for 40 days is a bug worth seeing, not garbage worth hiding.
 */
export async function pruneAgentRuns(env: Env, now = new Date()): Promise<RetentionResult> {
  const result: RetentionResult = { shortDeleted: 0, longDeleted: 0 };

  try {
    const db = drizzle(env.DB);
    const shortCutoff = new Date(now.getTime() - SHORT_RETENTION_DAYS * DAY_MS);
    const longCutoff = new Date(now.getTime() - LONG_RETENTION_DAYS * DAY_MS);

    // Two independent statements, run as one all-or-nothing D1 batch.
    // NEVER db.transaction(): D1 rejects BEGIN outright (error 7500) and the
    // callback never executes.
    const [shortRes, longRes] = await db.batch([
      db
        .delete(agentRuns)
        .where(
          and(
            inArray(agentRuns.status, [...SHORT_RETENTION_STATUSES]),
            lt(agentRuns.createdAt, shortCutoff),
          ),
        ),
      db
        .delete(agentRuns)
        .where(
          and(
            inArray(agentRuns.status, [...LONG_RETENTION_STATUSES]),
            lt(agentRuns.createdAt, longCutoff),
          ),
        ),
    ]);

    // D1 reports affected rows on the result meta; treat a missing count as 0
    // rather than guessing, so the log never overstates what was removed.
    result.shortDeleted = (shortRes as { meta?: { changes?: number } })?.meta?.changes ?? 0;
    result.longDeleted = (longRes as { meta?: { changes?: number } })?.meta?.changes ?? 0;

    if (result.shortDeleted || result.longDeleted) {
      console.log(
        `[agent-runs] retention: pruned ${result.shortDeleted} settled (>${SHORT_RETENTION_DAYS}d) ` +
          `and ${result.longDeleted} failed (>${LONG_RETENTION_DAYS}d) runs`,
      );
    }
  } catch (err) {
    console.error("[agent-runs] retention sweep failed:", err);
  }

  return result;
}

/**
 * How long a run may sit in `running`/`queued` before the sweep gives up on it.
 * Generous on purpose: the longest legitimate run here is a multi-stage render
 * campaign, and marking a live run dead is worse than reporting a dead one late.
 */
export const ABANDON_AFTER_HOURS = 24;

/** `error_code` written by the sweep. Groups on /admin/system/agents failures. */
export const ABANDONED_ERROR_CODE = "ABANDONED";

/**
 * Mark runs that will never finish as `failed` / `ABANDONED`.
 *
 * WHY THIS EXISTS: a run row is opened by `startRun` and closed by the caller.
 * When the isolate dies mid-run — `Worker exceeded memory limit`, an evicted
 * Workflow step, a thrown handler — nothing ever closes it, so the row sits in
 * `running` forever. `pruneAgentRuns` refuses to delete those by design, and
 * rightly so, but "keep it visible" was silently implemented as "keep it
 * visible AND keep it indistinguishable from a live run". The DO runaway
 * watcher counts `running` rows as evidence a Durable Object is awake and
 * billing, so 31 corpses from a crash three weeks ago pinned the whole system
 * health page to FAILURE and hid every real runaway behind a stale alarm.
 *
 * `failed` + an explicit `error_code` (rather than a new `abandoned` status) is
 * what this probe's own devOpsPlaybook prescribes: it needs no migration, no
 * enum change, and it inherits the 90-day failed-run retention for free.
 *
 * Never throws — this shares the daily cron with permit sync.
 */
export async function sweepAbandonedRuns(env: Env, now = new Date()): Promise<number> {
  try {
    const db = drizzle(env.DB);
    const cutoff = new Date(now.getTime() - ABANDON_AFTER_HOURS * 60 * 60 * 1000);

    const res = await db
      .update(agentRuns)
      .set({
        status: "failed",
        errorCode: ABANDONED_ERROR_CODE,
        errorMessage: `No terminal status recorded within ${ABANDON_AFTER_HOURS}h — the run's isolate died before it could close the row.`,
      })
      .where(
        and(
          inArray(agentRuns.status, ["running", "queued"]),
          lt(agentRuns.createdAt, cutoff),
          // Only rows nothing has already diagnosed. A run someone manually
          // annotated keeps its own error_code rather than being overwritten
          // with the generic one.
          isNull(agentRuns.errorCode),
        ),
      );

    const swept = (res as { meta?: { changes?: number } })?.meta?.changes ?? 0;
    if (swept) {
      console.log(`[agent-runs] swept ${swept} run(s) abandoned for >${ABANDON_AFTER_HOURS}h`);
    }
    return swept;
  } catch (err) {
    console.error("[agent-runs] abandoned-run sweep failed:", err);
    return 0;
  }
}

/**
 * Count runs currently in the ledger, by status. Used by the coverage/overview
 * endpoint and by QC to assert the sweep did not delete everything.
 */
export async function countRunsByStatus(env: Env): Promise<Record<string, number>> {
  const db = drizzle(env.DB);
  const rows = await db
    .select({ status: agentRuns.status, n: sql<number>`COUNT(*)` })
    .from(agentRuns)
    .groupBy(agentRuns.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}
