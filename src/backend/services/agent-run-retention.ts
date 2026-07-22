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
import { drizzle } from "drizzle-orm/d1";
import { and, inArray, lt, sql } from "drizzle-orm";

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
