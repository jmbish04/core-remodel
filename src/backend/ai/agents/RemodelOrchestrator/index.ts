/**
 * @fileoverview RemodelOrchestrator — Autonomous Project Auditor
 *
 * Extends Agent from the Cloudflare Agents SDK. Runs on a self-scheduling
 * 4-hour alarm loop. Each audit cycle:
 *
 * 1. Fetches all active tasks from the configured ClickUp List
 * 2. Runs DAG Critical Path Method (CPM) to identify the critical path
 *    and detect schedule slippage
 * 3. Uses Workers AI (llama-3-8b-instruct) to flag tasks missing critical
 *    execution details: dimensions, vendor links, SKUs, budget amounts,
 *    material specs
 * 4. Writes per-task flags and project-level alerts to D1
 * 5. Auto-resolves stale flags from previous audit runs
 *
 * The emotional labor of project management is offloaded to this function.
 * If a deadline slips or a task lacks detail, the objective automated system
 * flags it — not you.
 */

import { Agent, callable } from "agents";
import { and, eq, ne } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { clickupSystemAlerts, clickupTaskFlags } from "@backend/db";
import { ClickUpClient } from "@backend/services/clickup-client";

import { calculateCriticalPath } from "./critical-path";
import {
  DEFAULT_ORCHESTRATOR_STATE,
  type RemodelOrchestratorState,
} from "./types";

/** 4 hours between audit cycles. */
const AUDIT_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Workers AI model for task detail auditing. */
const AUDIT_MODEL = "@cf/meta/llama-3-8b-instruct" as const;

/** System prompt for the construction auditor. */
const AUDITOR_SYSTEM_PROMPT = `You are a rigid construction project auditor reviewing a home remodel task.
Analyze the task JSON and determine if critical execution details are missing.

Check for:
- Specific dimensions (measurements, square footage)
- Material specifications (brand, model, SKU, finish)
- Vendor or supplier links/references
- Budget or cost estimates (dollar amounts, price ranges)
- Permit references (if the task involves structural, electrical, or plumbing work)
- Contractor or responsible party assignment

Reply ONLY with valid JSON: { "flag_needed": true/false, "reason": "..." }
If flag_needed is false, reason should be "adequate".`;

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export class RemodelOrchestrator extends Agent<Env, RemodelOrchestratorState> {
  // ── Metadata ────────────────────────────────────────────────────

  static docsMetadata() {
    return {
      name: "RemodelOrchestrator",
      className: "RemodelOrchestrator",
      description:
        "Autonomous project auditor. Wakes on a 4-hour alarm, fetches tasks " +
        "from ClickUp, runs DAG critical path analysis, and uses Workers AI " +
        "to flag tasks missing vendor links, dimensions, SKUs, budget amounts, " +
        "or specs. Writes flags and alerts to D1 for frontend overlay.",
      docsPath: "/docs/agents/remodel-orchestrator",
      methods: [
        {
          name: "triggerAudit",
          description: "Manually trigger an audit cycle",
          params: "none",
          returns: "AuditResult",
        },
        {
          name: "configureList",
          description: "Set the ClickUp List ID to audit",
          params: "listId: string",
          returns: "{ ok: boolean, listId: string }",
        },
        {
          name: "getStatus",
          description: "Get the current orchestrator status and last audit info",
          params: "none",
          returns: "RemodelOrchestratorState",
        },
        {
          name: "healthProbe",
          description: "Verify all required bindings",
          params: "none",
          returns: "HealthProbeResult",
        },
      ],
      tools: [
        `Workers AI ${AUDIT_MODEL} (task detail audit)`,
        "ClickUp API v2 (task data source)",
        "D1 (flag + alert persistence)",
      ],
    };
  }

  // ── State ───────────────────────────────────────────────────────

  initialState = { ...DEFAULT_ORCHESTRATOR_STATE };

  // ── Lifecycle ───────────────────────────────────────────────────

  async onStart() {
    // Bootstrap the audit cycle 60s after creation to give time for configuration.
    // scheduleEvery() handles idempotent re-scheduling internally.
    await this.schedule(60, "audit");
  }

  // ── HTTP handler for internal trigger/status calls ─────────────

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/trigger-audit" && request.method === "POST") {
      const result = await this.runAuditCycle();
      return Response.json(result);
    }

    if (url.pathname === "/status") {
      return Response.json(this.state);
    }

    if (url.pathname === "/health") {
      const health = await this._healthProbe();
      return Response.json(health);
    }

    return new Response("Not found", { status: 404 });
  }

  // ── Alarm handler: The heartbeat ────────────────────────────────

  /** Named handler invoked by this.schedule(). */
  async audit() {
    try {
      await this.runAuditCycle();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("RemodelOrchestrator audit failed:", message);
      this.setState({
        ...this.state,
        status: "error",
        lastError: message,
      });
    } finally {
      // Self-healing loop: reschedule the next audit in 4 hours
      await this.schedule(AUDIT_INTERVAL_MS / 1000, "audit");
    }
  }

  // ── Core: 3-step audit pipeline ─────────────────────────────────

  private async runAuditCycle() {
    const auditRunId = crypto.randomUUID();
    this.setState({
      ...this.state,
      status: "auditing",
      lastAuditRunId: auditRunId,
      lastError: undefined,
    });

    const token = await this.env.CLICKUP_TOKEN.get();
    const teamId = await this.env.CLICKUP_TEAM_ID.get();
    const client = new ClickUpClient(token, teamId);
    const db = drizzle(this.env.DB);

    // ── Step 0: Validate configuration ──────────────────────────
    const listId = this.state.clickupListId;
    if (!listId) {
      console.warn(
        "RemodelOrchestrator: no clickupListId configured, skipping audit",
      );
      this.setState({ ...this.state, status: "idle" });
      return {
        status: "skipped",
        reason: "No ClickUp List ID configured. Call configureList() first.",
      };
    }

    // ── Step 1: Fetch State ─────────────────────────────────────
    const tasks = await client.getAllTasks(listId, { include_closed: false });

    // ── Step 2: Critical Path (DAG + CPM) ───────────────────────
    const { criticalPath, endDate, delayedTasks, floatMap } =
      calculateCriticalPath(tasks);

    let alertsGenerated = 0;
    let flagsGenerated = 0;

    // Write project delay alert if tasks are delayed
    if (delayedTasks.length > 0) {
      await db.insert(clickupSystemAlerts).values({
        alertType: "project_delay",
        severity: "critical",
        message: `Project timeline at risk. ${delayedTasks.length} task(s) are past due and causing downstream delays.`,
        metadata: JSON.stringify({
          delayedTaskIds: delayedTasks.map((t) => t.id),
          delayedTaskNames: delayedTasks.map((t) => t.name),
          projectedEndDate: endDate,
          criticalPathLength: criticalPath.length,
        }),
        auditRunId,
      });
      alertsGenerated++;
    }

    // Write CRITICAL_PATH flags for tasks on the critical path
    for (const task of criticalPath) {
      await db.insert(clickupTaskFlags).values({
        clickupTaskId: task.id,
        flagType: "CRITICAL_PATH",
        severity: "warning",
        message:
          "This task is on the critical path. Any delay directly pushes the project end date.",
        auditRunId,
      });
      flagsGenerated++;
    }

    // Write OVERDUE flags
    const now = new Date();
    for (const task of tasks) {
      if (
        task.due_date &&
        new Date(Number(task.due_date)) < now &&
        task.status?.status !== "complete" &&
        task.status?.status !== "closed"
      ) {
        const dueDate = new Date(Number(task.due_date));
        const daysOverdue = Math.ceil(
          (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24),
        );
        await db.insert(clickupTaskFlags).values({
          clickupTaskId: task.id,
          flagType: "OVERDUE",
          severity: "critical",
          message: `Task is ${daysOverdue} day(s) past its due date (${dueDate.toISOString().slice(0, 10)}).`,
          auditRunId,
        });
        flagsGenerated++;
      }
    }

    // ── Step 3: AI Detail Audit (Workers AI) ────────────────────
    const activeTasks = tasks.filter(
      (t) =>
        t.status?.status !== "complete" && t.status?.status !== "closed",
    );

    for (const task of activeTasks) {
      try {
        const taskPayload = JSON.stringify({
          name: task.name,
          description: task.description || task.text_content || "No description provided.",
          status: task.status?.status,
          tags: task.tags?.map((t) => t.name),
          due_date: task.due_date
            ? new Date(Number(task.due_date)).toISOString().slice(0, 10)
            : null,
          start_date: task.start_date
            ? new Date(Number(task.start_date)).toISOString().slice(0, 10)
            : null,
          priority: task.priority?.priority,
        });

        const aiResponse = (await this.env.AI.run(AUDIT_MODEL, {
          messages: [
            { role: "system", content: AUDITOR_SYSTEM_PROMPT },
            { role: "user", content: taskPayload },
          ],
        })) as { response?: string };

        const responseText = aiResponse.response || "{}";

        // Extract JSON from the response (handle markdown-wrapped responses)
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) continue;

        const analysis = JSON.parse(jsonMatch[0]) as {
          flag_needed: boolean;
          reason: string;
        };

        if (analysis.flag_needed) {
          await db.insert(clickupTaskFlags).values({
            clickupTaskId: task.id,
            flagType: "AI_AUDIT",
            severity: "warning",
            message: analysis.reason,
            auditRunId,
          });
          flagsGenerated++;
        }
      } catch (err) {
        // LLM returned malformed JSON or Workers AI transient error — skip
        console.warn(
          `AI audit error for task ${task.id} ("${task.name}"):`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    // ── Cleanup: Resolve stale flags from previous runs ─────────
    // Any unresolved flag from a DIFFERENT auditRunId is considered stale
    // because it wasn't regenerated in this cycle.
    await db
      .update(clickupTaskFlags)
      .set({ resolved: true, resolvedAt: new Date().toISOString() })
      .where(
        and(
          eq(clickupTaskFlags.resolved, false),
          ne(clickupTaskFlags.auditRunId, auditRunId),
        ),
      );

    // ── Update state ────────────────────────────────────────────
    const result = {
      status: "complete" as const,
      auditRunId,
      tasksAudited: activeTasks.length,
      flagsGenerated,
      alertsGenerated,
      criticalPathEndDate: endDate,
      criticalPathLength: criticalPath.length,
      delayedTaskCount: delayedTasks.length,
    };

    this.setState({
      ...this.state,
      status: "idle",
      lastAuditAt: new Date().toISOString(),
      lastAuditRunId: auditRunId,
      totalFlagsGenerated: flagsGenerated,
      totalAlertsGenerated: alertsGenerated,
      criticalPathEndDate: endDate,
      tasksAudited: activeTasks.length,
      lastError: undefined,
    });

    return result;
  }

  // ── Callable RPCs ──────────────────────────────────────────────

  /** Manually trigger an audit cycle outside the alarm schedule. */
  @callable()
  async triggerAudit() {
    return this.runAuditCycle();
  }

  /** Set the ClickUp List ID to audit. */
  @callable()
  async configureList(listId: string) {
    this.setState({ ...this.state, clickupListId: listId });
    return { ok: true, listId };
  }

  /** Get the current orchestrator status. */
  @callable()
  getStatus() {
    return this.state;
  }

  /** Verify all required bindings are available. */
  @callable()
  async healthProbe() {
    return this._healthProbe();
  }

  private async _healthProbe() {
    const checks: Record<string, boolean> = {};

    try {
      await this.env.CLICKUP_TOKEN.get();
      checks.clickupToken = true;
    } catch {
      checks.clickupToken = false;
    }

    try {
      await this.env.CLICKUP_TEAM_ID.get();
      checks.clickupTeamId = true;
    } catch {
      checks.clickupTeamId = false;
    }

    checks.ai = !!this.env.AI;
    checks.db = !!this.env.DB;
    checks.listConfigured = !!this.state.clickupListId;

    return {
      healthy: Object.values(checks).every(Boolean),
      checks,
      state: {
        status: this.state.status,
        lastAuditAt: this.state.lastAuditAt,
        clickupListId: this.state.clickupListId,
      },
    };
  }
}
