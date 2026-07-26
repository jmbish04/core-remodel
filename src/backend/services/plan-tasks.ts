/**
 * @fileoverview Single-task progress writes for `plan_tasks` — the shared logic
 * behind BOTH the HTTP `PATCH /api/admin/plans/tasks/:id` and the MCP
 * `update_plan_task` tool.
 *
 * A plan_task's `status`/`prNumber` is owned by whoever is doing the work, and it
 * changes many times over the life of a feature (pending → in_progress →
 * in_review+PR → done+PR). Every one of those ticks should reach an open
 * `/admin/changelog/preview/<slug>` viewer WITHOUT a manual refresh, so this
 * function fans out a lightweight realtime "poke" after each write via the shared
 * `EstimateCollabHub` DO. The client treats the poke as a signal to refetch.
 *
 * The publish is best-effort: a realtime hub that is down must never fail the
 * write itself (the poll loop is the fallback), so it is wrapped and logged.
 */
import { and, eq } from "drizzle-orm";

import { planTasks } from "@backend/db";
import type { PlanTask } from "@backend/db/schema/plans/plan_tasks";
import type { RemodelDb } from "@backend/mcp/types";
import { publishRealtimeEvent } from "@backend/realtime/publish";

/**
 * The six statuses a plan_task can hold. Mirrors the drizzle enum on
 * `plan_tasks.status` (0028 added `in_review` for the code-review step). This is
 * the single list the API validator, the MCP tool, and the rollup all read.
 */
export const PLAN_TASK_STATUSES = [
  "pending",
  "in_progress",
  "in_review",
  "blocked",
  "deferred",
  "done",
] as const;
export type PlanTaskStatus = (typeof PLAN_TASK_STATUSES)[number];

export interface PlanTaskPatch {
  status?: PlanTaskStatus;
  /** PR that carries this task. Explicit `null` clears it. */
  prNumber?: number | null;
  /** Soft link → changelog_entries.slug. Explicit `null` clears it. */
  changelogSlug?: string | null;
  notes?: string | null;
  progressPct?: number | null;
}

/** Locate the row by numeric id (HTTP board) or by (plan, taskKey) (MCP/agents). */
export type PlanTaskSelector = { id: number } | { planSlug: string; taskKey: string };

/** Realtime room a plan's task events fan out on. Client subscribes to the same. */
export function planRoom(planSlug: string): string {
  return `plan:${planSlug}`;
}

/**
 * Apply a sparse patch to one plan_task, then poke the plan's realtime room.
 * Returns the updated row, or null when the selector matched nothing.
 */
export async function updatePlanTask(
  env: Env,
  db: RemodelDb,
  selector: PlanTaskSelector,
  patch: PlanTaskPatch,
): Promise<PlanTask | null> {
  // Build a sparse set — `undefined` means "leave alone", an explicit `null`
  // clears the column. Only `updatedAt` is written unconditionally.
  const set: Partial<PlanTask> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.prNumber !== undefined) set.prNumber = patch.prNumber;
  if (patch.changelogSlug !== undefined) set.changelogSlug = patch.changelogSlug;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.progressPct !== undefined) set.progressPct = patch.progressPct;

  const where =
    "id" in selector
      ? eq(planTasks.id, selector.id)
      : and(eq(planTasks.planSlug, selector.planSlug), eq(planTasks.taskKey, selector.taskKey));

  const [updated] = await db.update(planTasks).set(set).where(where).returning();
  if (!updated) return null;

  try {
    await publishRealtimeEvent(env, planRoom(updated.planSlug), {
      kind: "plan_task",
      planSlug: updated.planSlug,
      taskKey: updated.taskKey,
      status: updated.status,
      prNumber: updated.prNumber,
      phase: updated.phase,
    });
  } catch (err) {
    // The poll loop is the fallback; a downed hub must not fail the write.
    console.error("[plan-tasks] realtime publish failed", err);
  }

  return updated;
}
