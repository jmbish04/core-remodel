/**
 * @fileoverview Admin-only router for runtime control of Cloudflare Workflows.
 *
 * Mounted at `/api/admin/workflows` — auto-inherits `requireAccessAuth` from the
 * `/api/admin/*` middleware in `src/backend/api/index.ts`.
 *
 * Pairs with:
 *   - `src/backend/db/schema/admin/workflow_schedules.ts` (D1 tables)
 *   - `src/backend/services/workflow-dispatcher.ts` (cron-fired dispatcher)
 *   - `src/backend/services/checklist-rationale-workflow.ts` (target Workflow)
 *   - `src/frontend/components/AdminWorkflowsPanel.tsx` (UI consumer)
 *
 * Live progress streams over the existing realtime DO at
 *   GET /api/realtime/estimates?room=admin-workflows:<jobKey>
 */

import {
  systemCronSchedules,
  workflowRunHistory,
} from "@backend/db";
import { publishRealtimeEvent } from "@backend/realtime/publish";
import {
  computeNextRunAt,
  isValidCronExpression,
} from "@backend/services/cron-utils";
import { zValidator } from "@hono/zod-validator";
import { asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { z } from "zod";

const adminWorkflowsRouter = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Job key registry — maps jobKey to the Workflow binding name.
//
// Keep in sync with `src/backend/services/workflow-dispatcher.ts`.
// ---------------------------------------------------------------------------

const KNOWN_JOB_KEYS = ["checklist_rationale"] as const;
type JobKey = (typeof KNOWN_JOB_KEYS)[number];

function isKnownJobKey(value: string): value is JobKey {
  return (KNOWN_JOB_KEYS as readonly string[]).includes(value);
}

function realtimeRoomFor(jobKey: string): string {
  return `admin-workflows:${jobKey}`;
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const updateScheduleSchema = z
  .object({
    cronExpression: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    description: z.string().nullable().optional(),
  })
  .refine(
    (value) =>
      value.cronExpression !== undefined ||
      value.enabled !== undefined ||
      value.description !== undefined,
    { message: "At least one field must be provided" },
  );

// ---------------------------------------------------------------------------
// GET /schedules — list all schedules
// ---------------------------------------------------------------------------

adminWorkflowsRouter.get("/schedules", async (c) => {
  const db = drizzle(c.env.DB);
  const schedules = await db
    .select()
    .from(systemCronSchedules)
    .orderBy(asc(systemCronSchedules.jobKey))
    .all();
  return c.json({ success: true, schedules });
});

// ---------------------------------------------------------------------------
// PATCH /schedules/:jobKey — update cron expression and/or enable flag
// ---------------------------------------------------------------------------

adminWorkflowsRouter.patch(
  "/schedules/:jobKey",
  zValidator("json", updateScheduleSchema),
  async (c) => {
    const db = drizzle(c.env.DB);
    const jobKey = c.req.param("jobKey");
    const body = c.req.valid("json");

    const existing = await db
      .select()
      .from(systemCronSchedules)
      .where(eq(systemCronSchedules.jobKey, jobKey))
      .get();

    if (!existing) {
      return c.json({ success: false, error: `Unknown jobKey "${jobKey}"` }, 404);
    }

    const updates: Partial<typeof systemCronSchedules.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (body.cronExpression !== undefined) {
      if (!isValidCronExpression(body.cronExpression)) {
        return c.json(
          {
            success: false,
            error: `Invalid cron expression "${body.cronExpression}"`,
          },
          400,
        );
      }
      updates.cronExpression = body.cronExpression;
      updates.nextRunAt = computeNextRunAt(body.cronExpression, new Date());
    }
    if (body.enabled !== undefined) {
      updates.enabled = body.enabled;
      // When enabling, also recompute nextRunAt off whatever expression now applies.
      if (body.enabled) {
        const cronExpr = updates.cronExpression ?? existing.cronExpression;
        updates.nextRunAt = computeNextRunAt(cronExpr, new Date());
      }
    }
    if (body.description !== undefined) {
      updates.description = body.description ?? null;
    }

    await db
      .update(systemCronSchedules)
      .set(updates)
      .where(eq(systemCronSchedules.jobKey, jobKey))
      .run();

    const updated = await db
      .select()
      .from(systemCronSchedules)
      .where(eq(systemCronSchedules.jobKey, jobKey))
      .get();

    await publishRealtimeEvent(c.env, realtimeRoomFor(jobKey), {
      type: "schedule_updated",
      jobKey,
      schedule: updated,
      timestamp: Date.now(),
    });

    return c.json({ success: true, schedule: updated });
  },
);

// ---------------------------------------------------------------------------
// POST /:jobKey/run — fire a workflow on demand
// ---------------------------------------------------------------------------

adminWorkflowsRouter.post("/:jobKey/run", async (c) => {
  const db = drizzle(c.env.DB);
  const jobKey = c.req.param("jobKey");

  if (!isKnownJobKey(jobKey)) {
    return c.json({ success: false, error: `Unknown jobKey "${jobKey}"` }, 404);
  }

  const workflowInstanceId = `${jobKey}-manual-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();

  const historyRows = await db
    .insert(workflowRunHistory)
    .values({
      jobKey,
      workflowInstanceId,
      triggerSource: "manual_admin",
      status: "queued",
      startedAt: now,
    })
    .returning();

  await publishRealtimeEvent(c.env, realtimeRoomFor(jobKey), {
    type: "queued",
    jobKey,
    workflowInstanceId,
    triggerSource: "manual_admin",
    timestamp: Date.now(),
  });

  try {
    if (jobKey === "checklist_rationale") {
      await c.env.CHECKLIST_RATIONALE_WORKFLOW.create({
        id: workflowInstanceId,
        params: { workflowInstanceId, triggerSource: "manual_admin" },
      });
    }
  } catch (error) {
    await db
      .update(workflowRunHistory)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage:
          error instanceof Error ? error.message : "Unknown workflow.create() failure",
      })
      .where(eq(workflowRunHistory.workflowInstanceId, workflowInstanceId))
      .run();

    await publishRealtimeEvent(c.env, realtimeRoomFor(jobKey), {
      type: "failed",
      jobKey,
      workflowInstanceId,
      error: error instanceof Error ? error.message : "Unknown error",
      timestamp: Date.now(),
    });

    return c.json(
      {
        success: false,
        workflowInstanceId,
        error: "Failed to enqueue workflow",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }

  return c.json({
    success: true,
    workflowInstanceId,
    runHistoryId: historyRows[0]?.id ?? null,
  });
});

// ---------------------------------------------------------------------------
// GET /:jobKey/runs — recent run history for the panel
// ---------------------------------------------------------------------------

adminWorkflowsRouter.get("/:jobKey/runs", async (c) => {
  const db = drizzle(c.env.DB);
  const jobKey = c.req.param("jobKey");
  const limit = Math.min(
    Number.parseInt(c.req.query("limit") ?? "20", 10) || 20,
    100,
  );

  const runs = await db
    .select()
    .from(workflowRunHistory)
    .where(eq(workflowRunHistory.jobKey, jobKey))
    .orderBy(desc(workflowRunHistory.startedAt))
    .limit(limit)
    .all();

  return c.json({ success: true, jobKey, runs });
});

export { adminWorkflowsRouter };
