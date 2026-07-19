import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Agent Run Ledger — one shared, agent-agnostic record of every agent
 * execution, its steps, and every tool call inside those steps.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this, agent work left almost no trace. The showroom scrape is the
 * clearest example: `showroom_stores.scrape_status` is a bare enum with no
 * error, no timestamp and no attempt count, so when 49 of 145 showrooms landed
 * in `failed` the only available UI was a blind "Scrape failed — retry" button.
 * Nobody — human or agent — could answer *why* it failed, whether a retry had
 * any chance of succeeding, or whether the same thing failed 5 times already.
 *
 * The fix is not per-feature status columns. It is one ledger that every agent
 * writes to through `services/agent-runs.ts`, so:
 *   - the monitoring UI is generic (a new agent shows up for free),
 *   - retries are informed rather than blind,
 *   - HITL approvals have somewhere to live,
 *   - and failure reasons survive the request that produced them.
 *
 * SCOPE
 * -----
 * This is the DURABLE, cross-request ledger. It is deliberately separate from:
 *   - `mcp_tool_invocations` — MCP transport logging only, no run/step grouping.
 *   - Durable Object agent state (e.g. `ScoutState.timeline`) — in-memory,
 *     per-session, bounded, and lost when the session resets.
 */

/** Lifecycle of a run. `needs_approval` is the HITL pause point. */
export const AGENT_RUN_STATUSES = [
  "queued",
  "running",
  "needs_approval",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /**
     * Which agent ran, as a stable slug — `showroom-research`,
     * `showroom-scout`, `permit-intelligence`. Not a FK: agents are code, not
     * rows, and a retired agent's history must survive its deletion.
     */
    agent: text("agent").notNull(),

    /** The specific capability invoked, e.g. `scrape_store`, `deep_sweep`. */
    operation: text("operation").notNull(),

    /**
     * What the run acted on, as a loose (type, id) pair rather than a FK per
     * possible target. Keeps one ledger usable for showrooms, products, drives
     * and anything added later.
     */
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** Human label for the target, denormalized so lists render without joins. */
    targetLabel: text("target_label"),

    status: text("status", { enum: AGENT_RUN_STATUSES }).notNull().default("queued"),

    /**
     * 1 for the first execution, incremented on each retry of the SAME logical
     * work. `parentRunId` links a retry back to the run it replaces, so the UI
     * can show "attempt 3 of 3" without losing the earlier failures.
     */
    attempt: integer("attempt").notNull().default(1),
    parentRunId: integer("parent_run_id"),

    /**
     * Stable, groupable failure code (`MAPS_QUOTA_EXCEEDED`, `503`,
     * `SCRAPE_TIMEOUT`). This is what makes "5 runs failed the same way"
     * visible instead of five unrelated incidents.
     */
    errorCode: text("error_code"),
    /** Full human-readable failure. Never truncate this into the code. */
    errorMessage: text("error_message"),

    /** Invocation input, JSON. Enough to replay the run. */
    inputJson: text("input_json"),
    /** Result summary, JSON. Not the full payload — a renderable digest. */
    outputJson: text("output_json"),

    /** Who/what started it: `cron`, `user`, `mcp`, `agent`. */
    triggeredBy: text("triggered_by"),

    startedAt: integer("started_at", { mode: "timestamp" }),
    endedAt: integer("ended_at", { mode: "timestamp" }),
    /** Denormalized so the queue can sort by duration without arithmetic. */
    durationMs: integer("duration_ms"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    // The monitoring page's three primary reads.
    statusCreatedIdx: index("agent_runs_status_created_idx").on(t.status, t.createdAt),
    agentCreatedIdx: index("agent_runs_agent_created_idx").on(t.agent, t.createdAt),
    targetIdx: index("agent_runs_target_idx").on(t.targetType, t.targetId),
  }),
);

/** A named phase within a run — what the step trace renders. */
export const agentRunSteps = sqliteTable(
  "agent_run_steps",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),

    /** 1-based position, so the trace renders in order without timestamps. */
    seq: integer("seq").notNull(),
    label: text("label").notNull(),

    status: text("status", { enum: AGENT_RUN_STATUSES }).notNull().default("running"),
    errorMessage: text("error_message"),

    startedAt: integer("started_at", { mode: "timestamp" }),
    endedAt: integer("ended_at", { mode: "timestamp" }),
    durationMs: integer("duration_ms"),
  },
  (t) => ({ runSeqIdx: index("agent_run_steps_run_seq_idx").on(t.runId, t.seq) }),
);

/**
 * One tool/external call. This is the layer that actually answers "why did it
 * fail" — the HTTP status, the upstream message, the arguments that produced it.
 */
export const agentRunToolCalls = sqliteTable(
  "agent_run_tool_calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    runId: integer("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    /** Null when a call happens outside any declared step. */
    stepId: integer("step_id").references(() => agentRunSteps.id, { onDelete: "cascade" }),

    tool: text("tool").notNull(),
    ok: integer("ok", { mode: "boolean" }).notNull().default(true),

    /**
     * Args and result as JSON, size-capped by the writer. Secrets are redacted
     * before they reach here — see `services/agent-runs.ts`.
     */
    argsJson: text("args_json"),
    resultJson: text("result_json"),

    errorCode: text("error_code"),
    errorMessage: text("error_message"),

    /** Which attempt of this tool call, for upstreams we retry internally. */
    attempt: integer("attempt").notNull().default(1),
    durationMs: integer("duration_ms"),

    at: integer("at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    runIdx: index("agent_run_tool_calls_run_idx").on(t.runId),
    // Powers "which tools fail most" without scanning every row.
    toolOkIdx: index("agent_run_tool_calls_tool_ok_idx").on(t.tool, t.ok),
  }),
);
