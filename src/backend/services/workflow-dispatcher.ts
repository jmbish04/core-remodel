/**
 * @fileoverview Master-tick dispatcher for runtime-configurable Workflow crons.
 *
 * `wrangler.jsonc` registers a static `* * * * *` cron trigger. On each tick,
 * `src/_worker.ts` calls `dispatchDueWorkflows(env)` here. We read
 * `system_cron_schedules` for rows where:
 *
 *   enabled = true
 *   AND (nextRunAt IS NULL OR nextRunAt <= now)
 *
 * For each due row we generate a `workflowInstanceId`, insert a queued
 * `workflow_run_history` row, fire the matching Workflow binding, and roll
 * `lastRunAt` + `nextRunAt` forward using `computeNextRunAt`.
 *
 * This is the bridge between Cloudflare's static cron config and the
 * admin-editable schedule UI.
 */

import { systemCronSchedules, workflowRunHistory } from "@backend/db";
import { publishRealtimeEvent } from "@backend/realtime/publish";
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { computeNextRunAt } from "./cron-utils";

const KNOWN_JOB_KEYS = ["checklist_rationale"] as const;
type JobKey = (typeof KNOWN_JOB_KEYS)[number];

function realtimeRoomFor(jobKey: string): string {
  return `admin-workflows:${jobKey}`;
}

function isKnownJobKey(value: string): value is JobKey {
  return (KNOWN_JOB_KEYS as readonly string[]).includes(value);
}

async function fireWorkflow(
  env: Env,
  jobKey: JobKey,
  workflowInstanceId: string,
): Promise<void> {
  switch (jobKey) {
    case "checklist_rationale":
      await env.CHECKLIST_RATIONALE_WORKFLOW.create({
        id: workflowInstanceId,
        params: { workflowInstanceId, triggerSource: "cron" },
      });
      return;
    default: {
      // Exhaustiveness guard
      const exhaustive: never = jobKey;
      throw new Error(`Unhandled jobKey "${exhaustive as string}"`);
    }
  }
}

export async function dispatchDueWorkflows(env: Env): Promise<void> {
  const db = drizzle(env.DB);
  const now = new Date();

  const due = await db
    .select()
    .from(systemCronSchedules)
    .where(
      and(
        eq(systemCronSchedules.enabled, true),
        or(
          isNull(systemCronSchedules.nextRunAt),
          lte(systemCronSchedules.nextRunAt, now),
        ),
      ),
    )
    .all();

  if (due.length === 0) {
    return;
  }

  for (const schedule of due) {
    if (!isKnownJobKey(schedule.jobKey)) {
      console.warn(
        `workflow-dispatcher: skipping unknown jobKey "${schedule.jobKey}"`,
      );
      continue;
    }

    const workflowInstanceId = `${schedule.jobKey}-cron-${now.getTime()}-${crypto.randomUUID().slice(0, 8)}`;
    let nextRunAt: Date | null = null;

    try {
      nextRunAt = computeNextRunAt(schedule.cronExpression, now);
    } catch (error) {
      console.error(
        `workflow-dispatcher: invalid cron expression for "${schedule.jobKey}"`,
        error,
      );
      // Disable to prevent a tight loop; admin must re-enable after fixing.
      await db
        .update(systemCronSchedules)
        .set({
          enabled: false,
          updatedAt: now,
          updatedBy: "workflow_dispatcher_self_disable",
        })
        .where(eq(systemCronSchedules.id, schedule.id))
        .run();
      continue;
    }

    await db
      .insert(workflowRunHistory)
      .values({
        jobKey: schedule.jobKey,
        workflowInstanceId,
        triggerSource: "cron",
        status: "queued",
        startedAt: now,
      })
      .run();

    await publishRealtimeEvent(env, realtimeRoomFor(schedule.jobKey), {
      type: "queued",
      jobKey: schedule.jobKey,
      workflowInstanceId,
      triggerSource: "cron",
      timestamp: now.getTime(),
    });

    try {
      await fireWorkflow(env, schedule.jobKey, workflowInstanceId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error firing workflow";
      console.error("workflow-dispatcher: fire failed", errorMessage);
      await db
        .update(workflowRunHistory)
        .set({
          status: "failed",
          finishedAt: new Date(),
          errorMessage,
        })
        .where(eq(workflowRunHistory.workflowInstanceId, workflowInstanceId))
        .run();
      await publishRealtimeEvent(env, realtimeRoomFor(schedule.jobKey), {
        type: "failed",
        jobKey: schedule.jobKey,
        workflowInstanceId,
        error: errorMessage,
        timestamp: Date.now(),
      });
      continue;
    }

    await db
      .update(systemCronSchedules)
      .set({
        lastRunAt: now,
        nextRunAt,
        updatedAt: now,
        updatedBy: "workflow_dispatcher",
      })
      .where(eq(systemCronSchedules.id, schedule.id))
      .run();
  }
}
