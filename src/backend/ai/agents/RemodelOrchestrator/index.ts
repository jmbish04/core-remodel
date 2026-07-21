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
import { and, eq, ne, or, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { clickupSystemAlerts, clickupTaskFlags } from "@backend/db";
import { ClickUpClient } from "@backend/services/clickup-client";
import {
  evaluateFireWindow,
  readCircuitBreaker,
  scheduleTableExceeded,
  tripCircuitBreaker,
  type FireWindow,
} from "@backend/services/safety/do-circuit-breaker";

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

  /** Once-per-instance guard so the fire-window DDL doesn't run every alarm. */
  private cbTableCreated = false;

  // ── Lifecycle ───────────────────────────────────────────────────

  async onStart() {
    // Respect the global kill-switch: if the breaker is tripped, do not arm an
    // alarm at all (and clear any backlog), so a wake can't restart the loop.
    if (await this.isCircuitBreakerTripped()) {
      this.sql`DELETE FROM cf_agents_schedules WHERE callback = 'audit'`;
      return;
    }
    // Bootstrap the audit cycle 60s after creation to give time for configuration.
    await this.ensureAuditSchedule(60);
  }

  /**
   * Circuit-breaker guard — the second line of defence behind the #162 fix. Run at
   * the top of every alarm fire BEFORE any work. On any runaway signal it TRIPS
   * (flips the global kill-switch), drops the schedule backlog, and returns false so
   * the caller hard-stops WITHOUT rescheduling. The checks are cheap by design (a
   * D1 single-row read, a SARGABLE count, an O(1) window compare) so the guard can
   * never itself become the cost.
   *
   * Returns true only when it is safe to run and re-arm.
   */
  private async circuitBreakerGuard(): Promise<boolean> {
    // 1. Global kill-switch — another DO (or a prior trip) may have halted us.
    if (await this.isCircuitBreakerTripped()) {
      this.sql`DELETE FROM cf_agents_schedules WHERE callback = 'audit'`;
      console.error("[RemodelOrchestrator] circuit breaker tripped — refusing to run/reschedule.");
      return false;
    }

    // 2. Schedule-table bound — the EXACT #162 signature. A healthy DO keeps one
    // pending 'audit' row; a growing count means the append-only backlog is back.
    const scheduleRows = this.sql`
      SELECT count(*) AS n FROM cf_agents_schedules WHERE callback = 'audit'
    ` as unknown as Array<{ n: number }>;
    const pending = Number(scheduleRows[0]?.n ?? 0);
    if (scheduleTableExceeded(pending)) {
      this.sql`DELETE FROM cf_agents_schedules WHERE callback = 'audit'`;
      await this.safeTrip(
        `cf_agents_schedules 'audit' rows=${pending} exceeded the safe bound — halting to prevent the #162 row-read runaway.`,
      );
      return false;
    }

    // 3. Fire-rate — a 4-hour cadence firing many times a minute is a loop.
    // Create the window table once per instance lifetime, not on every fire.
    if (!this.cbTableCreated) {
      this.sql`
        CREATE TABLE IF NOT EXISTS cb_audit_fire_window (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          window_start INTEGER NOT NULL,
          count INTEGER NOT NULL
        )
      `;
      this.cbTableCreated = true;
    }
    const prevRows = this.sql`
      SELECT window_start AS windowStart, count FROM cb_audit_fire_window WHERE id = 1
    ` as unknown as Array<{ windowStart: number; count: number }>;
    const prev: FireWindow | null = prevRows[0]
      ? { windowStart: Number(prevRows[0].windowStart), count: Number(prevRows[0].count) }
      : null;
    const { window, fires, tripped } = evaluateFireWindow(prev, Date.now());
    this.sql`
      INSERT INTO cb_audit_fire_window (id, window_start, count)
      VALUES (1, ${window.windowStart}, ${window.count})
      ON CONFLICT(id) DO UPDATE SET window_start = ${window.windowStart}, count = ${window.count}
    `;
    if (tripped) {
      this.sql`DELETE FROM cf_agents_schedules WHERE callback = 'audit'`;
      await this.safeTrip(
        `audit fired ${fires} times within the rate window — halting a suspected alarm loop.`,
      );
      return false;
    }

    return true;
  }

  /**
   * Flip the global kill-switch, swallowing any D1 error. A throw here would
   * bubble out of the alarm handler and, in DO semantics, trigger an automatic
   * RETRY — the opposite of the clean hard-stop we want (the schedule backlog is
   * already deleted by the caller). So the trip is best-effort: log and return.
   */
  private async safeTrip(reason: string): Promise<void> {
    try {
      await tripCircuitBreaker(this.env.DB, "RemodelOrchestrator", reason);
    } catch (err) {
      console.error("[RemodelOrchestrator] failed to record circuit-breaker trip in D1:", err);
    }
  }

  /** Read the global kill-switch (D1-backed, shared across all alarm DOs). */
  private async isCircuitBreakerTripped(): Promise<boolean> {
    try {
      return (await readCircuitBreaker(this.env.DB)).tripped;
    } catch (err) {
      // A failed read must NOT block work (fail-open on the guard's own error),
      // but it also must not crash the alarm — log and proceed.
      console.warn("[RemodelOrchestrator] circuit-breaker read failed:", err);
      return false;
    }
  }

  /**
   * Queue exactly one pending "audit" schedule, clearing any already there.
   *
   * `this.schedule()` is append-only — it inserts a fresh row in
   * `cf_agents_schedules` every call, it does NOT dedupe. onStart() runs on
   * every DO wake (not once per lifetime) and audit()'s finally block adds
   * another, so pending schedules compounded: more rows -> more alarms -> more
   * rows. The table reached ~1M rows and every alarm full-scanned it, billing
   * 537 BILLION Durable Object row reads in 30 days (~$512).
   *
   * Clears via bulk SQL rather than listSchedules() + cancelSchedule(): this
   * runs from onStart() on an instance whose table may still hold ~1M rows,
   * and materializing those into memory OOMs the Durable Object before any
   * repair can run. That makes the DELETE the self-heal path — the first
   * wake after deploy drops the backlog with no manual step.
   *
   * ponytail: single unbatched DELETE. Fine at ~1M rows in local SQLite; if a
   * future instance is orders of magnitude worse, chunk it with a LIMIT loop.
   */
  private ensureAuditSchedule(delaySeconds: number) {
    // Deletes bill as rows written (~$1 per million) — one time, on first wake.
    this.sql`DELETE FROM cf_agents_schedules WHERE callback = 'audit'`;
    return this.schedule(delaySeconds, "audit");
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
    // Circuit-breaker guard FIRST. On a trip it returns false having already
    // dropped the schedule backlog — we then hard-stop with NO reschedule, so the
    // loop cannot restart itself. Downtime here is deliberate: it is the price of
    // never repeating the #162 runaway.
    if (!(await this.circuitBreakerGuard())) {
      this.setState({
        ...this.state,
        status: "error",
        lastError: "Circuit breaker tripped — audit halted. Clear it from /admin/integrations/usage.",
      });
      return;
    }

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
      // Self-healing loop: reschedule the next audit in 4 hours. Must replace,
      // not append — see ensureAuditSchedule(). Only reached when the guard passed.
      await this.ensureAuditSchedule(AUDIT_INTERVAL_MS / 1000);
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

    // Collect every flag first, then bulk-insert in chunked batches below —
    // avoids one D1 round-trip per task across the three flag-producing passes.
    const flagsToInsert: (typeof clickupTaskFlags.$inferInsert)[] = [];

    // Write CRITICAL_PATH flags for tasks on the critical path
    for (const task of criticalPath) {
      flagsToInsert.push({
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
        flagsToInsert.push({
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
          gateway: { id: this.env.AI_GATEWAY_ID },
        } as Parameters<typeof this.env.AI.run>[1])) as { response?: string };

        const responseText = aiResponse.response || "{}";

        // Extract JSON from the response (handle markdown-wrapped responses)
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) continue;

        const analysis = JSON.parse(jsonMatch[0]) as {
          flag_needed: boolean;
          reason: string;
        };

        if (analysis.flag_needed) {
          flagsToInsert.push({
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

    // Bulk-insert the collected flags in chunks. Single-row inserts via
    // db.batch() keep each query under D1's 100-bound-parameter limit while
    // collapsing many round-trips into one batch call.
    const FLAG_BATCH_SIZE = 50;
    for (let i = 0; i < flagsToInsert.length; i += FLAG_BATCH_SIZE) {
      const chunk = flagsToInsert.slice(i, i + FLAG_BATCH_SIZE);
      await db.batch(
        chunk.map((flag) =>
          db.insert(clickupTaskFlags).values(flag),
        ) as unknown as Parameters<typeof db.batch>[0],
      );
    }

    // ── Cleanup: Resolve stale flags from previous runs ─────────
    // Any unresolved flag from a DIFFERENT auditRunId is considered stale
    // because it wasn't regenerated in this cycle. `auditRunId <> ?` alone
    // evaluates to UNKNOWN for NULL rows, so those would never resolve —
    // isNull() catches legacy/NULL-tagged flags too.
    await db
      .update(clickupTaskFlags)
      .set({ resolved: true, resolvedAt: new Date().toISOString() })
      .where(
        and(
          eq(clickupTaskFlags.resolved, false),
          or(
            ne(clickupTaskFlags.auditRunId, auditRunId),
            isNull(clickupTaskFlags.auditRunId),
          ),
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
