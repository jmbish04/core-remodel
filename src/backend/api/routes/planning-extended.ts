/**
 * @fileoverview Extended planning API routes — Task 5.1 and 5.2 (feature 0005).
 *
 * Adds to the existing /api/planning surface:
 *
 *   GET /api/planning/tasks          — list/filter/search tasks (T5.1)
 *   GET /api/planning/tasks/stats    — status-count aggregates (T5.1)
 *   GET /api/planning/board          — tasks grouped by status (Kanban) (T5.2)
 *   GET /api/planning/timeline       — start/due/deps for Gantt (T5.2)
 *   GET /api/planning/calendar       — tasks by date range (T5.2)
 *   GET /api/planning/projects       — epics-as-projects with task rollups (T5.2)
 *   POST /api/planning/projects      — create a new epic/project (T5.2 gap fill)
 *   PATCH /api/planning/projects/:id — update an epic/project (T5.2 gap fill)
 *
 * All routes use live Drizzle queries against D1 — no mock data.
 * Registered with raw Hono (consistent with planning.ts pattern in this codebase).
 * Both routers are mounted together in api/index.ts under /api/planning.
 *
 * Zod v4 usage: z.string().min(1), z.iso.datetime() when applicable.
 * No floating promises — all async calls awaited before response.
 */

import { and, asc, between, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import {
  planningEpics,
  planningTasks,
} from "@backend/db";
import { ensurePlanningSeed } from "@backend/services/planning-seed";

const planningExtendedRouter = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TaskStatus = "pending" | "in_progress" | "blocked" | "delayed" | "done";
type TaskPriority = 1 | 2 | 3; // 1=high 2=medium 3=low

const VALID_STATUSES = new Set<TaskStatus>([
  "pending",
  "in_progress",
  "blocked",
  "delayed",
  "done",
]);

/** Parse JSON arrays stored in D1 text columns. */
function parseJsonArray<T = unknown>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** Clamp an integer to [min, max]. */
function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Parse a positive integer query parameter with a fallback. */
function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// ---------------------------------------------------------------------------
// T5.1 — GET /api/planning/tasks  (list / filter / search)
// ---------------------------------------------------------------------------

/**
 * List planning tasks with optional filters.
 *
 * Query params:
 *   roomId   — integer, filter by room_id
 *   status   — one of: pending | in_progress | blocked | delayed | done
 *   priority — 1 | 2 | 3
 *   q        — free-text search against title + description
 *   epicId   — UUID, filter by epic
 *   page     — 1-based page number (default 1)
 *   pageSize — max items per page (default 20, max 100)
 *
 * Response: { success, tasks, pagination: { page, pageSize, total } }
 */
planningExtendedRouter.get("/tasks", async (c) => {
  try {
    await ensurePlanningSeed(c.env);
    const db = drizzle(c.env.DB);

    // --- Parse filters ---
    const roomIdRaw = c.req.query("roomId");
    const statusRaw = c.req.query("status");
    const priorityRaw = c.req.query("priority");
    const epicIdRaw = c.req.query("epicId");
    const q = c.req.query("q")?.trim() ?? "";
    const page = parsePositiveInt(c.req.query("page"), 1);
    const pageSize = clampInt(
      parsePositiveInt(c.req.query("pageSize"), 20),
      1,
      100,
    );

    const roomId =
      roomIdRaw && Number.isFinite(Number(roomIdRaw))
        ? Math.trunc(Number(roomIdRaw))
        : null;
    const status: TaskStatus | null =
      statusRaw && VALID_STATUSES.has(statusRaw as TaskStatus)
        ? (statusRaw as TaskStatus)
        : null;
    const priority: TaskPriority | null =
      priorityRaw && [1, 2, 3].includes(Number(priorityRaw))
        ? (Number(priorityRaw) as TaskPriority)
        : null;
    const epicId = epicIdRaw?.trim() || null;

    // --- Build where conditions ---
    const conditions = [];
    if (roomId !== null) conditions.push(eq(planningTasks.roomId, roomId));
    if (status) conditions.push(eq(planningTasks.status, status));
    if (priority !== null)
      conditions.push(eq(planningTasks.priority, priority));
    if (epicId) conditions.push(eq(planningTasks.epicId, epicId));
    if (q) {
      conditions.push(
        or(
          like(planningTasks.title, `%${q}%`),
          like(planningTasks.description, `%${q}%`),
        ),
      );
    }

    // --- Fetch all matching rows (D1 doesn't support LIMIT+OFFSET on all
    //     compound queries cleanly; paginate in JS for small task datasets) ---
    const allTasks =
      conditions.length > 0
        ? await db
            .select()
            .from(planningTasks)
            .where(and(...conditions))
            .orderBy(
              asc(planningTasks.epicId),
              asc(planningTasks.taskOrder),
              asc(planningTasks.title),
            )
            .all()
        : await db
            .select()
            .from(planningTasks)
            .orderBy(
              asc(planningTasks.epicId),
              asc(planningTasks.taskOrder),
              asc(planningTasks.title),
            )
            .all();

    const total = allTasks.length;
    const offset = (page - 1) * pageSize;
    const pageItems = allTasks.slice(offset, offset + pageSize);

    const tasks = pageItems.map((task) => ({
      ...task,
      supportParticipantIds: parseJsonArray<number>(task.supportParticipantIds),
      consultedParticipantIds: parseJsonArray<number>(
        task.consultedParticipantIds,
      ),
      informedParticipantIds: parseJsonArray<number>(task.informedParticipantIds),
      dependsOnTaskIds: parseJsonArray<string>(task.dependsOnTaskIds),
    }));

    return c.json({
      success: true,
      tasks,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    return c.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Failed to list tasks" },
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// T5.1 — GET /api/planning/tasks/stats
// ---------------------------------------------------------------------------

/**
 * Returns status-count aggregates for planning tasks.
 *
 * Query params:
 *   roomId — integer (optional) — scope to a specific room
 *
 * Response: { success, stats: { open, in_progress, blocked, delayed, done, total } }
 *
 * Note: "open" is the count of tasks with status "pending" (not-started).
 * "total" is all tasks regardless of status.
 */
planningExtendedRouter.get("/tasks/stats", async (c) => {
  try {
    await ensurePlanningSeed(c.env);
    const db = drizzle(c.env.DB);

    const roomIdRaw = c.req.query("roomId");
    const roomId =
      roomIdRaw && Number.isFinite(Number(roomIdRaw))
        ? Math.trunc(Number(roomIdRaw))
        : null;

    const allTasks =
      roomId !== null
        ? await db
            .select({ status: planningTasks.status })
            .from(planningTasks)
            .where(eq(planningTasks.roomId, roomId))
            .all()
        : await db.select({ status: planningTasks.status }).from(planningTasks).all();

    const stats = {
      open: 0,
      in_progress: 0,
      blocked: 0,
      delayed: 0,
      done: 0,
      total: allTasks.length,
    };

    for (const { status } of allTasks) {
      if (status === "pending") stats.open += 1;
      else if (status === "in_progress") stats.in_progress += 1;
      else if (status === "blocked") stats.blocked += 1;
      else if (status === "delayed") stats.delayed += 1;
      else if (status === "done") stats.done += 1;
    }

    return c.json({ success: true, stats });
  } catch (error) {
    return c.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Failed to compute task stats" },
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// T5.2 — GET /api/planning/board  (Kanban — tasks grouped by status)
// ---------------------------------------------------------------------------

/**
 * Returns tasks grouped by status for a Kanban board view.
 *
 * Query params:
 *   roomId — integer (optional) — scope to a specific room
 *
 * Response:
 * {
 *   success,
 *   board: {
 *     pending:     Task[],
 *     in_progress: Task[],
 *     blocked:     Task[],
 *     delayed:     Task[],
 *     done:        Task[]
 *   }
 * }
 *
 * Within each column tasks are ordered by (taskOrder asc, title asc).
 */
planningExtendedRouter.get("/board", async (c) => {
  try {
    await ensurePlanningSeed(c.env);
    const db = drizzle(c.env.DB);

    const roomIdRaw = c.req.query("roomId");
    const roomId =
      roomIdRaw && Number.isFinite(Number(roomIdRaw))
        ? Math.trunc(Number(roomIdRaw))
        : null;

    const allTasks =
      roomId !== null
        ? await db
            .select()
            .from(planningTasks)
            .where(eq(planningTasks.roomId, roomId))
            .orderBy(asc(planningTasks.taskOrder), asc(planningTasks.title))
            .all()
        : await db
            .select()
            .from(planningTasks)
            .orderBy(asc(planningTasks.taskOrder), asc(planningTasks.title))
            .all();

    function enrichTask(task: (typeof allTasks)[number]) {
      return {
        ...task,
        supportParticipantIds: parseJsonArray<number>(task.supportParticipantIds),
        consultedParticipantIds: parseJsonArray<number>(
          task.consultedParticipantIds,
        ),
        informedParticipantIds: parseJsonArray<number>(
          task.informedParticipantIds,
        ),
        dependsOnTaskIds: parseJsonArray<string>(task.dependsOnTaskIds),
      };
    }

    const board = {
      pending: allTasks.filter((t) => t.status === "pending").map(enrichTask),
      in_progress: allTasks
        .filter((t) => t.status === "in_progress")
        .map(enrichTask),
      blocked: allTasks.filter((t) => t.status === "blocked").map(enrichTask),
      delayed: allTasks.filter((t) => t.status === "delayed").map(enrichTask),
      done: allTasks.filter((t) => t.status === "done").map(enrichTask),
    };

    return c.json({ success: true, board });
  } catch (error) {
    return c.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Failed to load kanban board" },
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// T5.2 — GET /api/planning/timeline  (Gantt data — start/due/deps)
// ---------------------------------------------------------------------------

/**
 * Returns tasks with date ranges and dependency IDs for Gantt rendering.
 *
 * Query params:
 *   roomId — integer (optional)
 *
 * Response:
 * {
 *   success,
 *   tasks: Array<{
 *     id, title, status, priority, epicId,
 *     startDate, dueDate,
 *     dependsOnTaskIds: string[]
 *   }>
 * }
 */
planningExtendedRouter.get("/timeline", async (c) => {
  try {
    await ensurePlanningSeed(c.env);
    const db = drizzle(c.env.DB);

    const roomIdRaw = c.req.query("roomId");
    const roomId =
      roomIdRaw && Number.isFinite(Number(roomIdRaw))
        ? Math.trunc(Number(roomIdRaw))
        : null;

    const allTasks =
      roomId !== null
        ? await db
            .select({
              id: planningTasks.id,
              title: planningTasks.title,
              status: planningTasks.status,
              priority: planningTasks.priority,
              epicId: planningTasks.epicId,
              roomId: planningTasks.roomId,
              startDate: planningTasks.startDate,
              dueDate: planningTasks.dueDate,
              dependsOnTaskIds: planningTasks.dependsOnTaskIds,
              taskOrder: planningTasks.taskOrder,
            })
            .from(planningTasks)
            .where(eq(planningTasks.roomId, roomId))
            .orderBy(asc(planningTasks.startDate), asc(planningTasks.taskOrder))
            .all()
        : await db
            .select({
              id: planningTasks.id,
              title: planningTasks.title,
              status: planningTasks.status,
              priority: planningTasks.priority,
              epicId: planningTasks.epicId,
              roomId: planningTasks.roomId,
              startDate: planningTasks.startDate,
              dueDate: planningTasks.dueDate,
              dependsOnTaskIds: planningTasks.dependsOnTaskIds,
              taskOrder: planningTasks.taskOrder,
            })
            .from(planningTasks)
            .orderBy(asc(planningTasks.startDate), asc(planningTasks.taskOrder))
            .all();

    const tasks = allTasks.map((task) => ({
      ...task,
      dependsOnTaskIds: parseJsonArray<string>(task.dependsOnTaskIds),
    }));

    return c.json({ success: true, tasks });
  } catch (error) {
    return c.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Failed to load timeline" },
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// T5.2 — GET /api/planning/calendar  (tasks by date range)
// ---------------------------------------------------------------------------

/**
 * Returns tasks whose dueDate or startDate falls within [from, to].
 *
 * Query params:
 *   from   — YYYY-MM-DD (required)
 *   to     — YYYY-MM-DD (required)
 *   roomId — integer (optional)
 *
 * Response:
 * {
 *   success,
 *   tasks: Task[],       // tasks with at least one date in range
 *   from, to
 * }
 */
planningExtendedRouter.get("/calendar", async (c) => {
  try {
    const from = c.req.query("from")?.trim() ?? "";
    const to = c.req.query("to")?.trim() ?? "";

    if (!from || !to) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Both 'from' and 'to' date params (YYYY-MM-DD) are required",
          },
        },
        400,
      );
    }

    // Validate ISO date format (YYYY-MM-DD)
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(from) || !dateRe.test(to)) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Dates must be in YYYY-MM-DD format",
          },
        },
        400,
      );
    }

    await ensurePlanningSeed(c.env);
    const db = drizzle(c.env.DB);

    const roomIdRaw = c.req.query("roomId");
    const roomId =
      roomIdRaw && Number.isFinite(Number(roomIdRaw))
        ? Math.trunc(Number(roomIdRaw))
        : null;

    // Fetch all then filter in JS — D1 has limited OR support for text comparisons
    const baseTasks =
      roomId !== null
        ? await db
            .select()
            .from(planningTasks)
            .where(eq(planningTasks.roomId, roomId))
            .all()
        : await db.select().from(planningTasks).all();

    // Keep tasks whose startDate or dueDate overlaps [from, to]
    const inRange = baseTasks.filter((task) => {
      const start = task.startDate ?? "";
      const due = task.dueDate ?? "";
      if (!start && !due) return false;
      // Task overlaps range if either anchor is within [from, to]
      const startInRange = start >= from && start <= to;
      const dueInRange = due >= from && due <= to;
      // Also include tasks that span the entire range (start < from && due > to)
      const spansRange = start < from && due > to;
      return startInRange || dueInRange || spansRange;
    });

    const tasks = inRange.map((task) => ({
      ...task,
      supportParticipantIds: parseJsonArray<number>(task.supportParticipantIds),
      consultedParticipantIds: parseJsonArray<number>(
        task.consultedParticipantIds,
      ),
      informedParticipantIds: parseJsonArray<number>(task.informedParticipantIds),
      dependsOnTaskIds: parseJsonArray<string>(task.dependsOnTaskIds),
    }));

    return c.json({ success: true, tasks, from, to });
  } catch (error) {
    return c.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Failed to load calendar" },
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// T5.2 — GET /api/planning/projects  (epics-as-projects with task rollups)
// ---------------------------------------------------------------------------

/**
 * Returns all planning epics as "projects" with task-count rollups per status.
 *
 * Query params:
 *   roomId — integer (optional) — when provided, rollup counts include only
 *            tasks scoped to that room
 *
 * Response:
 * {
 *   success,
 *   projects: Array<{
 *     id, slug, title, description, phaseOrder,
 *     taskCounts: { pending, in_progress, blocked, delayed, done, total },
 *     completionPct: number  // 0-100
 *   }>
 * }
 */
planningExtendedRouter.get("/projects", async (c) => {
  try {
    await ensurePlanningSeed(c.env);
    const db = drizzle(c.env.DB);

    const roomIdRaw = c.req.query("roomId");
    const roomId =
      roomIdRaw && Number.isFinite(Number(roomIdRaw))
        ? Math.trunc(Number(roomIdRaw))
        : null;

    const [epics, allTasks] = await Promise.all([
      db
        .select()
        .from(planningEpics)
        .orderBy(asc(planningEpics.phaseOrder), asc(planningEpics.title))
        .all(),
      roomId !== null
        ? db
            .select({
              epicId: planningTasks.epicId,
              status: planningTasks.status,
            })
            .from(planningTasks)
            .where(eq(planningTasks.roomId, roomId))
            .all()
        : db
            .select({
              epicId: planningTasks.epicId,
              status: planningTasks.status,
            })
            .from(planningTasks)
            .all(),
    ]);

    // Build per-epic count maps
    const countsByEpic = new Map<
      string,
      { pending: number; in_progress: number; blocked: number; delayed: number; done: number }
    >();

    for (const { epicId, status } of allTasks) {
      if (!countsByEpic.has(epicId)) {
        countsByEpic.set(epicId, {
          pending: 0,
          in_progress: 0,
          blocked: 0,
          delayed: 0,
          done: 0,
        });
      }
      const counts = countsByEpic.get(epicId)!;
      if (status === "pending") counts.pending += 1;
      else if (status === "in_progress") counts.in_progress += 1;
      else if (status === "blocked") counts.blocked += 1;
      else if (status === "delayed") counts.delayed += 1;
      else if (status === "done") counts.done += 1;
    }

    const projects = epics.map((epic) => {
      const counts = countsByEpic.get(epic.id) ?? {
        pending: 0,
        in_progress: 0,
        blocked: 0,
        delayed: 0,
        done: 0,
      };
      const total =
        counts.pending +
        counts.in_progress +
        counts.blocked +
        counts.delayed +
        counts.done;
      const completionPct = total > 0 ? Math.round((counts.done / total) * 100) : 0;

      return {
        id: epic.id,
        slug: epic.slug,
        title: epic.title,
        description: epic.description,
        phaseOrder: epic.phaseOrder,
        metadata: epic.metadata,
        datetimeCreated: epic.datetimeCreated,
        datetimeUpdated: epic.datetimeUpdated,
        taskCounts: { ...counts, total },
        completionPct,
      };
    });

    return c.json({ success: true, projects });
  } catch (error) {
    return c.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Failed to load projects" },
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// T5.2 gap fill — POST /api/planning/projects  (create epic/project)
// ---------------------------------------------------------------------------

/**
 * Creates a new planning epic (project).
 *
 * Body (JSON):
 *   title       string  (required)
 *   description string  (optional)
 *   phaseOrder  number  (optional, default 0)
 *   slug        string  (optional, auto-derived from title if missing)
 *
 * Response: { success, project }
 */
planningExtendedRouter.post("/projects", async (c) => {
  try {
    await ensurePlanningSeed(c.env);
    const db = drizzle(c.env.DB);
    const body = (await c.req.json()) as {
      title?: string;
      description?: string;
      phaseOrder?: number;
      slug?: string;
    };

    const title = body.title?.trim() ?? "";
    if (!title) {
      return c.json(
        {
          error: { code: "VALIDATION_ERROR", message: "title is required" },
        },
        400,
      );
    }

    const slug =
      body.slug?.trim() ||
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 80);
    const phaseOrder = Number.isFinite(Number(body.phaseOrder))
      ? Math.trunc(Number(body.phaseOrder))
      : 0;
    const epicId = crypto.randomUUID();

    await db
      .insert(planningEpics)
      .values({
        id: epicId,
        slug,
        title,
        description: body.description?.trim() || null,
        phaseOrder,
      })
      .run();

    const created = await db
      .select()
      .from(planningEpics)
      .where(eq(planningEpics.id, epicId))
      .get();

    return c.json({ success: true, project: created }, 201);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    if (msg.includes("UNIQUE") || msg.includes("unique")) {
      return c.json(
        {
          error: {
            code: "CONFLICT",
            message: "A project with that slug already exists",
          },
        },
        409,
      );
    }
    return c.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Failed to create project" },
        details: msg,
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// T5.2 gap fill — PATCH /api/planning/projects/:id  (update epic/project)
// ---------------------------------------------------------------------------

/**
 * Updates a planning epic (project).
 *
 * Path param: id — UUID of the epic
 * Body (JSON, all optional):
 *   title, description, phaseOrder
 *
 * Response: { success, project }
 */
planningExtendedRouter.patch("/projects/:id", async (c) => {
  try {
    await ensurePlanningSeed(c.env);
    const db = drizzle(c.env.DB);
    const epicId = c.req.param("id");
    const body = (await c.req.json()) as {
      title?: string;
      description?: string;
      phaseOrder?: number;
    };

    const existing = await db
      .select()
      .from(planningEpics)
      .where(eq(planningEpics.id, epicId))
      .get();
    if (!existing) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Project not found" } },
        404,
      );
    }

    const updates: Partial<typeof planningEpics.$inferInsert> = {};
    if (body.title !== undefined) {
      const trimmed = body.title.trim();
      if (!trimmed) {
        return c.json(
          { error: { code: "VALIDATION_ERROR", message: "title cannot be empty" } },
          400,
        );
      }
      updates.title = trimmed;
    }
    if (body.description !== undefined) {
      updates.description = body.description?.trim() || null;
    }
    if (body.phaseOrder !== undefined && Number.isFinite(Number(body.phaseOrder))) {
      updates.phaseOrder = Math.trunc(Number(body.phaseOrder));
    }

    if (Object.keys(updates).length === 0) {
      return c.json(
        { error: { code: "VALIDATION_ERROR", message: "No valid fields to update" } },
        400,
      );
    }

    updates.datetimeUpdated = new Date();
    await db
      .update(planningEpics)
      .set(updates)
      .where(eq(planningEpics.id, epicId))
      .run();

    const updated = await db
      .select()
      .from(planningEpics)
      .where(eq(planningEpics.id, epicId))
      .get();

    return c.json({ success: true, project: updated });
  } catch (error) {
    return c.json(
      {
        error: { code: "INTERNAL_ERROR", message: "Failed to update project" },
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { planningExtendedRouter };
