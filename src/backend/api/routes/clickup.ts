/**
 * @fileoverview ClickUp integration API routes
 *
 * Hono router mounted at /api/clickup. Acts as a proxy + audit layer:
 * - READ: Fetches live from ClickUp API (source of truth)
 * - WRITE: Logs revision to D1 BEFORE sending to ClickUp
 * - FLAGS: Serves AI/algorithmic task flags from D1
 * - ALERTS: Serves system-level project risk alerts from D1
 * - ORCHESTRATOR: Manual trigger for the RemodelOrchestrator agent
 *
 * All routes require access auth via requireAccessAuth middleware.
 */

import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

import {
  clickupRevisionLog,
  clickupSystemAlerts,
  clickupTaskFlags,
} from "@backend/db";
import {
  ClickUpClient,
  type CreateTaskPayload,
  type UpdateTaskPayload,
} from "@backend/services/clickup-client";

export const clickupRouter = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getClient(env: Env): Promise<ClickUpClient> {
  const token = await env.CLICKUP_TOKEN.get();
  const teamId = await env.CLICKUP_TEAM_ID.get();
  return new ClickUpClient(token, teamId);
}

// ---------------------------------------------------------------------------
// Tasks — proxied to ClickUp (source of truth)
// ---------------------------------------------------------------------------

/** GET /tasks — Fetch all tasks from a ClickUp List */
clickupRouter.get("/tasks", async (c) => {
  const client = await getClient(c.env);
  const listId = c.req.query("list_id");
  if (!listId) return c.json({ error: "list_id query param required" }, 400);

  const tasks = await client.getTasks(listId, {
    page: Number(c.req.query("page") || 0),
    statuses: c.req.queries("status"),
    include_closed: c.req.query("include_closed") === "true",
    subtasks: c.req.query("subtasks") === "true",
  });

  return c.json({ tasks });
});

/** GET /tasks/:taskId — Fetch single task detail from ClickUp */
clickupRouter.get("/tasks/:taskId", async (c) => {
  const client = await getClient(c.env);
  const task = await client.getTask(c.req.param("taskId"));
  return c.json({ task });
});

/** POST /tasks — Create a task in ClickUp. Logs revision to D1. */
clickupRouter.post("/tasks", async (c) => {
  const client = await getClient(c.env);
  const db = drizzle(c.env.DB);
  const body = await c.req.json<CreateTaskPayload>();
  const listId = c.req.query("list_id");
  if (!listId) return c.json({ error: "list_id query param required" }, 400);

  // 1. Pre-flight audit: log revision BEFORE sending to ClickUp
  let revisionId: number | null = null;
  try {
    const [revision] = await db
      .insert(clickupRevisionLog)
      .values({
        clickupListId: listId,
        operation: "create",
        requestPayload: JSON.stringify(body),
        actor: "admin",
      })
      .returning();
    revisionId = revision.id;
  } catch (dbErr) {
    console.error("D1 revision insert failed (non-blocking):", dbErr);
  }

  // 2. Create in ClickUp
  try {
    const task = await client.createTask(listId, body);

    // 3. Back-fill revision with ClickUp response
    if (revisionId) {
      await db
        .update(clickupRevisionLog)
        .set({
          clickupTaskId: task.id,
          responsePayload: JSON.stringify(task),
          responseStatus: 200,
        })
        .where(eq(clickupRevisionLog.id, revisionId))
        .catch((e) => console.error("Revision back-fill failed:", e));
    }

    return c.json({ task }, 201);
  } catch (err: any) {
    const status = err.status || 500;
    const detail = err.body || err.message || "Unknown ClickUp error";
    console.error(`ClickUp createTask failed [${status}]:`, detail);
    return c.json({ error: "ClickUp API error", detail, status }, status);
  }
});

/** PUT /tasks/:taskId — Update a task in ClickUp. Logs revision to D1. */
clickupRouter.put("/tasks/:taskId", async (c) => {
  const client = await getClient(c.env);
  const db = drizzle(c.env.DB);
  const taskId = c.req.param("taskId");
  const body = await c.req.json<UpdateTaskPayload>();

  // 1. Pre-flight audit
  let revisionId: number | null = null;
  try {
    const [revision] = await db
      .insert(clickupRevisionLog)
      .values({
        clickupTaskId: taskId,
        operation: "update",
        requestPayload: JSON.stringify(body),
        actor: "admin",
      })
      .returning();
    revisionId = revision.id;
  } catch (dbErr) {
    console.error("D1 revision insert failed (non-blocking):", dbErr);
  }

  // 2. Update in ClickUp
  try {
    const task = await client.updateTask(taskId, body);

    // 3. Back-fill revision
    if (revisionId) {
      await db
        .update(clickupRevisionLog)
        .set({
          responsePayload: JSON.stringify(task),
          responseStatus: 200,
        })
        .where(eq(clickupRevisionLog.id, revisionId))
        .catch((e) => console.error("Revision back-fill failed:", e));
    }

    return c.json({ task });
  } catch (err: any) {
    const status = err.status || 500;
    const detail = err.body || err.message || "Unknown ClickUp error";
    console.error(`ClickUp updateTask failed [${status}]:`, detail);
    return c.json({ error: "ClickUp API error", detail, status }, status);
  }
});

/** DELETE /tasks/:taskId — Delete a task in ClickUp. Logs revision to D1. */
clickupRouter.delete("/tasks/:taskId", async (c) => {
  const client = await getClient(c.env);
  const db = drizzle(c.env.DB);
  const taskId = c.req.param("taskId");

  await db.insert(clickupRevisionLog).values({
    clickupTaskId: taskId,
    operation: "delete",
    requestPayload: JSON.stringify({ taskId }),
    actor: "admin",
  });

  await client.deleteTask(taskId);
  return c.json({ ok: true });
});

/** POST /tasks/:taskId/attachments — Upload to R2, append link to ClickUp description */
clickupRouter.post("/tasks/:taskId/attachments", async (c) => {
  const client = await getClient(c.env);
  const db = drizzle(c.env.DB);
  const taskId = c.req.param("taskId");

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return c.json({ error: "file field required" }, 400);

  const label = (formData.get("label") as string) || file.name;

  // 1. Upload to R2
  const r2Key = `clickup-attachments/${taskId}/${Date.now()}-${file.name}`;
  await c.env.ARTIFACTS_BUCKET.put(r2Key, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
  });

  // 2. Build the public URL (assumes custom domain or public bucket)
  const publicUrl = `https://core-remodel.hacolby.workers.dev/api/artifacts/${encodeURIComponent(r2Key)}`;

  // 3. Append link to ClickUp task description
  const task = await client.appendLinkToDescription(taskId, label, publicUrl);

  // 4. Log revision
  await db.insert(clickupRevisionLog).values({
    clickupTaskId: taskId,
    operation: "attachment",
    requestPayload: JSON.stringify({ label, r2Key, publicUrl }),
    responsePayload: JSON.stringify(task),
    responseStatus: 200,
    r2AttachmentKey: r2Key,
    actor: "admin",
  });

  return c.json({ task, r2Key, publicUrl }, 201);
});

// ---------------------------------------------------------------------------
// Revision log — query D1 audit trail
// ---------------------------------------------------------------------------

/** GET /revisions — Query the D1 revision history */
clickupRouter.get("/revisions", async (c) => {
  const db = drizzle(c.env.DB);
  const taskId = c.req.query("task_id");
  const operation = c.req.query("operation");
  const limit = Math.min(Number(c.req.query("limit") || 50), 200);
  const offset = Number(c.req.query("offset") || 0);

  const conditions = [];
  if (taskId) conditions.push(eq(clickupRevisionLog.clickupTaskId, taskId));
  if (operation) conditions.push(eq(clickupRevisionLog.operation, operation));

  const rows = await db
    .select()
    .from(clickupRevisionLog)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(clickupRevisionLog.id))
    .limit(limit)
    .offset(offset);

  return c.json({ revisions: rows, limit, offset });
});

// ---------------------------------------------------------------------------
// Flags — AI/algorithmic task flags from Orchestrator
// ---------------------------------------------------------------------------

/** GET /flags — Fetch active task flags from D1 */
clickupRouter.get("/flags", async (c) => {
  const db = drizzle(c.env.DB);
  const taskId = c.req.query("task_id");
  const flagType = c.req.query("flag_type");
  const showResolved = c.req.query("resolved") === "true";

  const conditions = [];
  if (taskId) conditions.push(eq(clickupTaskFlags.clickupTaskId, taskId));
  if (flagType) conditions.push(eq(clickupTaskFlags.flagType, flagType));
  if (!showResolved) conditions.push(eq(clickupTaskFlags.resolved, false));

  const flags = await db
    .select()
    .from(clickupTaskFlags)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(clickupTaskFlags.id))
    .limit(500);

  return c.json({ flags });
});

/** POST /flags/:flagId/dismiss — Mark a flag as resolved */
clickupRouter.post("/flags/:flagId/dismiss", async (c) => {
  const db = drizzle(c.env.DB);
  const flagId = Number(c.req.param("flagId"));

  await db
    .update(clickupTaskFlags)
    .set({ resolved: true, resolvedAt: new Date().toISOString() })
    .where(eq(clickupTaskFlags.id, flagId));

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Alerts — system-level project risk alerts
// ---------------------------------------------------------------------------

/** GET /alerts — Fetch active system alerts from D1 */
clickupRouter.get("/alerts", async (c) => {
  const db = drizzle(c.env.DB);
  const showAcknowledged = c.req.query("acknowledged") === "true";
  const severity = c.req.query("severity");

  const conditions = [];
  if (!showAcknowledged)
    conditions.push(eq(clickupSystemAlerts.acknowledged, false));
  if (severity) conditions.push(eq(clickupSystemAlerts.severity, severity));

  const alerts = await db
    .select()
    .from(clickupSystemAlerts)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(clickupSystemAlerts.id))
    .limit(100);

  return c.json({ alerts });
});

/** POST /alerts/:alertId/acknowledge — Mark an alert as acknowledged */
clickupRouter.post("/alerts/:alertId/acknowledge", async (c) => {
  const db = drizzle(c.env.DB);
  const alertId = Number(c.req.param("alertId"));

  await db
    .update(clickupSystemAlerts)
    .set({ acknowledged: true, acknowledgedAt: new Date().toISOString() })
    .where(eq(clickupSystemAlerts.id, alertId));

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Config — workspace metadata for frontend dropdowns
// ---------------------------------------------------------------------------

/** GET /config — Returns ClickUp workspace metadata (spaces, lists) */
clickupRouter.get("/config", async (c) => {
  const client = await getClient(c.env);

  const spaces = await client.getSpaces();
  const listsPerSpace: Record<string, unknown[]> = {};

  for (const space of spaces) {
    listsPerSpace[space.id] = await client.getFolderlessLists(space.id);
  }

  return c.json({
    defaultListId: c.env.CLICKUP_LIST_ID || "",
    spaces,
    listsPerSpace,
  });
});

// ---------------------------------------------------------------------------
// Orchestrator — manual trigger
// ---------------------------------------------------------------------------

/** POST /orchestrator/trigger — Manually trigger an Orchestrator audit cycle */
clickupRouter.post("/orchestrator/trigger", async (c) => {
  const stub = c.env.REMODEL_ORCHESTRATOR.getByName("main-house-project");
  const response = await stub.fetch(
    new Request("http://internal/trigger-audit", { method: "POST" }),
  );

  if (!response.ok) {
    return c.json({ error: "Orchestrator trigger failed" }, 500);
  }

  return c.json({ ok: true, message: "Audit cycle triggered" });
});

/** GET /orchestrator/status — Get current Orchestrator state */
clickupRouter.get("/orchestrator/status", async (c) => {
  const stub = c.env.REMODEL_ORCHESTRATOR.getByName("main-house-project");
  const response = await stub.fetch(
    new Request("http://internal/status"),
  );

  if (!response.ok) {
    return c.json({ error: "Failed to fetch orchestrator status" }, 500);
  }

  const status = await response.json();
  return c.json({ status });
});
