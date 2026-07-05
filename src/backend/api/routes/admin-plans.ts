/**
 * @fileoverview Roadmap tracker API — `/api/admin/plans`
 *
 * Backs the `/admin/plans` live progress monitor. Gated by `requireAccessAuth`
 * via the `/api/admin/*` middleware registered in `src/backend/api/index.ts`.
 *
 *   GET   /api/admin/plans              List plans + progress rollups.
 *   GET   /api/admin/plans/:slug        One plan + its tasks (grouped/rolled-up).
 *   PATCH /api/admin/plans/tasks/:id    Update a task's status/notes.
 *   POST  /api/admin/plans/:slug/seed   Idempotent (re)seed from the canonical list.
 *
 * Progress is owned by the tasks' `status` column, updated over time by future
 * sessions; the frontend polls these read endpoints for near-real-time updates.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq, asc, sql } from "drizzle-orm";

import { plans, planTasks } from "@backend/db/schema/plans/index";
import type { PlanTask } from "@backend/db/schema/plans/index";
import { seedPlanTasks } from "@backend/db/seeds/seed-plan-tasks";

export const adminPlansRouter = new Hono<{ Bindings: Env }>();

const TASK_STATUSES = ["pending", "in_progress", "blocked", "deferred", "done"] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

/** Roll a task list up into status counts + a completion percentage. */
function rollup(tasks: Pick<PlanTask, "status">[]) {
  const counts: Record<TaskStatus, number> = {
    pending: 0,
    in_progress: 0,
    blocked: 0,
    deferred: 0,
    done: 0,
  };
  for (const task of tasks) counts[task.status as TaskStatus]++;
  const total = tasks.length;
  const percent = total > 0 ? Math.round((counts.done / total) * 100) : 0;
  return { total, percent, counts };
}

// ─── GET / — all plans + progress ────────────────────────────────────────────

adminPlansRouter.get("/", async (c) => {
  const db = drizzle(c.env.DB);

  // Bootstrap: auto-seed on first authed load so the tracker is populated without
  // a manual step (the seed is idempotent, so this is a one-time no-op thereafter).
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(plans);
  if (Number(n) === 0) {
    try {
      await seedPlanTasks(db);
    } catch (err) {
      console.error("[admin-plans] auto-seed failed:", err);
    }
  }

  const [allPlans, allTasks] = await Promise.all([
    db.select().from(plans).orderBy(asc(plans.sortOrder)),
    db.select({ planSlug: planTasks.planSlug, status: planTasks.status }).from(planTasks),
  ]);

  const tasksByPlan = new Map<string, Pick<PlanTask, "status">[]>();
  for (const task of allTasks) {
    const arr = tasksByPlan.get(task.planSlug) ?? [];
    arr.push({ status: task.status });
    tasksByPlan.set(task.planSlug, arr);
  }

  const result = allPlans.map((plan) => ({
    ...plan,
    progress: rollup(tasksByPlan.get(plan.slug) ?? []),
  }));

  return c.json({ success: true, plans: result });
});

// ─── GET /:slug — one plan + its tasks ───────────────────────────────────────

adminPlansRouter.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const db = drizzle(c.env.DB);

  const [plan] = await db.select().from(plans).where(eq(plans.slug, slug)).limit(1);
  if (!plan) return c.json({ success: false, error: "Plan not found" }, 404);

  const tasks = await db
    .select()
    .from(planTasks)
    .where(eq(planTasks.planSlug, slug))
    .orderBy(asc(planTasks.phase), asc(planTasks.sortOrder));

  // Roll up per-phase and per-workstream for the board headers.
  const byPhase = new Map<number, PlanTask[]>();
  const byWorkstream = new Map<string, PlanTask[]>();
  for (const task of tasks) {
    if (!byPhase.has(task.phase)) byPhase.set(task.phase, []);
    byPhase.get(task.phase)!.push(task);
    if (!byWorkstream.has(task.workstream)) byWorkstream.set(task.workstream, []);
    byWorkstream.get(task.workstream)!.push(task);
  }

  return c.json({
    success: true,
    plan,
    progress: rollup(tasks),
    tasks,
    phases: [...byPhase.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([phase, ts]) => ({ phase, progress: rollup(ts) })),
    workstreams: [...byWorkstream.entries()].map(([workstream, ts]) => ({
      workstream,
      progress: rollup(ts),
    })),
  });
});

// ─── PATCH /tasks/:id — update status/notes ──────────────────────────────────

adminPlansRouter.patch("/tasks/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ success: false, error: "Invalid task id" }, 400);

  const body = (await c.req.json().catch(() => ({}))) as { status?: string; notes?: string };
  const update: Partial<PlanTask> = { updatedAt: new Date() };

  if (body.status !== undefined) {
    if (!TASK_STATUSES.includes(body.status as TaskStatus)) {
      return c.json({ success: false, error: `status must be one of ${TASK_STATUSES.join(", ")}` }, 400);
    }
    update.status = body.status as TaskStatus;
  }
  if (body.notes !== undefined) update.notes = body.notes;

  const [updated] = await db_update(c, id, update);
  if (!updated) return c.json({ success: false, error: "Task not found" }, 404);
  return c.json({ success: true, task: updated });
});

/** Small helper to keep the PATCH handler tidy. */
async function db_update(c: { env: Env }, id: number, update: Partial<PlanTask>) {
  const db = drizzle(c.env.DB);
  return db.update(planTasks).set(update).where(eq(planTasks.id, id)).returning();
}

// ─── POST /:slug/seed — idempotent (re)seed ──────────────────────────────────
// Seeds ALL plans/tasks (the canonical list is global); :slug is accepted for
// convenience/readability but the seed is not slug-scoped.

adminPlansRouter.post("/:slug/seed", async (c) => {
  const db = drizzle(c.env.DB);
  try {
    const result = await seedPlanTasks(db);
    return c.json({ success: true, ...result });
  } catch (err) {
    console.error("[admin-plans] seed error:", err);
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
