/**
 * @fileoverview Read-only queries over the agent run ledger.
 *
 * Deliberately separate from `agent-runs.ts`, which owns every WRITE. The
 * writer is best-effort and swallows its own errors, because losing real work
 * to a telemetry bug is unacceptable. A reader must do the opposite — a query
 * that silently returns `[]` on error would render an empty, reassuring
 * dashboard during exactly the incident it exists to expose. So these throw,
 * and the route layer turns that into a visible 500.
 */
import {
  agentRunSteps,
  agentRunToolCalls,
  agentRuns,
  geminiUsage,
} from "@backend/db";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { AgentRunStatus } from "@backend/db/schema/agents/runs";

import { AGENT_SURFACES, kindForRun, labelForAgent, type SurfaceKind } from "./agent-registry";

type Db = ReturnType<typeof drizzle>;

const HOUR_MS = 60 * 60 * 1000;

/** One row in the queue / failure list. */
export interface RunSummary {
  id: number;
  agent: string;
  agentLabel: string;
  operation: string;
  surface: SurfaceKind | "user";
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  status: string;
  attempt: number;
  parentRunId: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  triggeredBy: string | null;
  durationMs: number | null;
  createdAt: Date | null;
  stepsTotal: number;
  stepsDone: number;
  /** 0..100, or null when the run has declared no steps yet. */
  percent: number | null;
}

export interface ListRunsFilter {
  /** Validated at the route boundary, so the query layer can stay typed. */
  status?: AgentRunStatus[];
  agent?: string;
  /** Only runs created at or after this instant. */
  since?: Date;
  limit?: number;
}

function toSummary(r: {
  id: number;
  agent: string;
  operation: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  status: string;
  attempt: number;
  parentRunId: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  triggeredBy: string | null;
  durationMs: number | null;
  createdAt: Date | null;
  stepsTotal: number | null;
  stepsDone: number | null;
}): RunSummary {
  const stepsTotal = Number(r.stepsTotal ?? 0);
  const stepsDone = Number(r.stepsDone ?? 0);
  return {
    id: r.id,
    agent: r.agent,
    agentLabel: labelForAgent(r.agent),
    operation: r.operation,
    surface: kindForRun(r.agent, r.triggeredBy),
    targetType: r.targetType,
    targetId: r.targetId,
    targetLabel: r.targetLabel,
    status: r.status,
    attempt: r.attempt,
    parentRunId: r.parentRunId,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    triggeredBy: r.triggeredBy,
    durationMs: r.durationMs,
    createdAt: r.createdAt,
    stepsTotal,
    stepsDone,
    // A finished run with no declared steps is 100% done, not 0% — otherwise
    // every uninstrumented-at-step-level agent renders as permanently stalled.
    percent:
      stepsTotal > 0
        ? Math.round((stepsDone / stepsTotal) * 100)
        : r.status === "succeeded"
          ? 100
          : null,
  };
}

/** Queue / list read. One grouped query, backed by agent_runs_status_created_idx. */
export async function listRuns(env: Env, filter: ListRunsFilter = {}): Promise<RunSummary[]> {
  const db = drizzle(env.DB);
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);

  const where = [];
  if (filter.status?.length) where.push(inArray(agentRuns.status, filter.status));
  if (filter.agent) where.push(eq(agentRuns.agent, filter.agent));
  if (filter.since) where.push(gte(agentRuns.createdAt, filter.since));

  const rows = await db
    .select({
      id: agentRuns.id,
      agent: agentRuns.agent,
      operation: agentRuns.operation,
      targetType: agentRuns.targetType,
      targetId: agentRuns.targetId,
      targetLabel: agentRuns.targetLabel,
      status: agentRuns.status,
      attempt: agentRuns.attempt,
      parentRunId: agentRuns.parentRunId,
      errorCode: agentRuns.errorCode,
      errorMessage: agentRuns.errorMessage,
      triggeredBy: agentRuns.triggeredBy,
      durationMs: agentRuns.durationMs,
      createdAt: agentRuns.createdAt,
      stepsTotal: sql<number>`COUNT(${agentRunSteps.id})`,
      stepsDone: sql<number>`SUM(CASE WHEN ${agentRunSteps.status} = 'succeeded' THEN 1 ELSE 0 END)`,
    })
    .from(agentRuns)
    .leftJoin(agentRunSteps, eq(agentRunSteps.runId, agentRuns.id))
    .where(where.length ? and(...where) : undefined)
    .groupBy(agentRuns.id)
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit);

  return rows.map(toSummary);
}

export interface RunDetail {
  run: RunSummary & { inputJson: unknown; outputJson: unknown; startedAt: Date | null; endedAt: Date | null };
  steps: Array<{
    id: number;
    seq: number;
    label: string;
    status: string;
    errorMessage: string | null;
    durationMs: number | null;
    toolCalls: Array<{
      id: number;
      tool: string;
      ok: boolean;
      errorCode: string | null;
      errorMessage: string | null;
      attempt: number;
      durationMs: number | null;
      at: Date | null;
      argsJson: unknown;
      resultJson: unknown;
    }>;
  }>;
  /** Tool calls made outside any step (step_id IS NULL). */
  looseToolCalls: RunDetail["steps"][number]["toolCalls"];
  /** The retry chain this run belongs to, oldest attempt first. */
  lineage: Array<{ id: number; attempt: number; status: string; errorCode: string | null; createdAt: Date | null }>;
  /** Spend attributed to this run. */
  cost: { totalTokens: number; costUsd: number; calls: number };
}

/**
 * One run, fully expanded.
 *
 * The lineage walk is iterative rather than a recursive CTE: D1 supports the
 * CTE, but the chain is bounded by retry count (single digits in practice) and
 * an explicit loop with a hard cap cannot become a runaway query if a
 * `parent_run_id` cycle is ever written by a bug.
 */
export async function getRun(env: Env, id: number): Promise<RunDetail | null> {
  const db = drizzle(env.DB);

  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
  if (!run) return null;

  const [steps, toolCalls, cost] = await Promise.all([
    db.select().from(agentRunSteps).where(eq(agentRunSteps.runId, id)).orderBy(agentRunSteps.seq),
    db.select().from(agentRunToolCalls).where(eq(agentRunToolCalls.runId, id)).orderBy(agentRunToolCalls.at),
    db
      .select({
        totalTokens: sql<number>`COALESCE(SUM(${geminiUsage.totalTokens}), 0)`,
        costUsd: sql<number>`COALESCE(SUM(${geminiUsage.estimatedCostUsd}), 0)`,
        calls: sql<number>`COUNT(*)`,
      })
      .from(geminiUsage)
      .where(eq(geminiUsage.agentRunId, id))
      .get(),
  ]);

  const mapCall = (c: (typeof toolCalls)[number]) => ({
    id: c.id,
    tool: c.tool,
    ok: Boolean(c.ok),
    errorCode: c.errorCode,
    errorMessage: c.errorMessage,
    attempt: c.attempt,
    durationMs: c.durationMs,
    at: c.at,
    argsJson: c.argsJson,
    resultJson: c.resultJson,
  });

  const byStep = new Map<number, ReturnType<typeof mapCall>[]>();
  const loose: ReturnType<typeof mapCall>[] = [];
  for (const c of toolCalls) {
    if (c.stepId === null) loose.push(mapCall(c));
    else byStep.set(c.stepId, [...(byStep.get(c.stepId) ?? []), mapCall(c)]);
  }

  // Walk up to the root of the retry chain, then back down through this run's
  // descendants. Capped so a cyclic parent_run_id cannot spin forever.
  const lineage = await buildLineage(db, run.id, run.parentRunId);

  const stepsTotal = steps.length;
  const stepsDone = steps.filter((s) => s.status === "succeeded").length;

  return {
    run: {
      ...toSummary({ ...run, stepsTotal, stepsDone }),
      inputJson: run.inputJson,
      outputJson: run.outputJson,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
    },
    steps: steps.map((s) => ({
      id: s.id,
      seq: s.seq,
      label: s.label,
      status: s.status,
      errorMessage: s.errorMessage,
      durationMs: s.durationMs,
      toolCalls: byStep.get(s.id) ?? [],
    })),
    looseToolCalls: loose,
    lineage,
    cost: {
      totalTokens: Number(cost?.totalTokens ?? 0),
      costUsd: Number(cost?.costUsd ?? 0),
      calls: Number(cost?.calls ?? 0),
    },
  };
}

const MAX_LINEAGE = 25;

async function buildLineage(
  db: Db,
  runId: number,
  parentRunId: number | null,
): Promise<RunDetail["lineage"]> {
  const seen = new Set<number>([runId]);
  const ids: number[] = [runId];

  // Ancestors.
  let cursor = parentRunId;
  while (cursor !== null && ids.length < MAX_LINEAGE && !seen.has(cursor)) {
    seen.add(cursor);
    ids.push(cursor);
    const [parent] = await db
      .select({ parentRunId: agentRuns.parentRunId })
      .from(agentRuns)
      .where(eq(agentRuns.id, cursor))
      .limit(1);
    cursor = parent?.parentRunId ?? null;
  }

  // Descendants (retries of this run, and retries of those).
  let frontier = [runId];
  while (frontier.length && ids.length < MAX_LINEAGE) {
    const children = await db
      .select({ id: agentRuns.id })
      .from(agentRuns)
      .where(inArray(agentRuns.parentRunId, frontier));
    frontier = children.map((c) => c.id).filter((cid) => !seen.has(cid));
    for (const cid of frontier) {
      seen.add(cid);
      ids.push(cid);
    }
  }

  if (ids.length <= 1) return [];

  const rows = await db
    .select({
      id: agentRuns.id,
      attempt: agentRuns.attempt,
      status: agentRuns.status,
      errorCode: agentRuns.errorCode,
      createdAt: agentRuns.createdAt,
    })
    .from(agentRuns)
    .where(inArray(agentRuns.id, ids));

  return rows.sort((a, b) => a.attempt - b.attempt || a.id - b.id);
}

export interface FailureGroup {
  errorCode: string | null;
  agent: string;
  agentLabel: string;
  operation: string;
  count: number;
  latest: Date | null;
  sampleRunId: number;
}

/**
 * "Five runs failed the same way" — the question no per-feature status column
 * in this codebase can answer today.
 */
export async function groupFailures(env: Env, since: Date): Promise<FailureGroup[]> {
  const db = drizzle(env.DB);
  const rows = await db
    .select({
      errorCode: agentRuns.errorCode,
      agent: agentRuns.agent,
      operation: agentRuns.operation,
      count: sql<number>`COUNT(*)`,
      latest: sql<number>`MAX(${agentRuns.createdAt})`,
      sampleRunId: sql<number>`MAX(${agentRuns.id})`,
    })
    .from(agentRuns)
    .where(and(eq(agentRuns.status, "failed"), gte(agentRuns.createdAt, since)))
    .groupBy(agentRuns.errorCode, agentRuns.agent, agentRuns.operation)
    .orderBy(desc(sql`COUNT(*)`));

  return rows.map((r) => ({
    errorCode: r.errorCode,
    agent: r.agent,
    agentLabel: labelForAgent(r.agent),
    operation: r.operation,
    count: Number(r.count),
    latest: r.latest ? new Date(Number(r.latest) * 1000) : null,
    sampleRunId: Number(r.sampleRunId),
  }));
}

export interface AgentSpend {
  agent: string;
  agentLabel: string;
  provider: string;
  model: string;
  tokens: number;
  costUsd: number;
  calls: number;
  erroredCalls: number;
}

/** Spend attributed by agent — the join the migration exists for. */
export async function spendByAgent(env: Env, since: Date): Promise<AgentSpend[]> {
  const db = drizzle(env.DB);
  const rows = await db
    .select({
      agent: sql<string>`COALESCE(${agentRuns.agent}, '(unattributed)')`,
      provider: geminiUsage.provider,
      model: geminiUsage.model,
      tokens: sql<number>`COALESCE(SUM(${geminiUsage.totalTokens}), 0)`,
      costUsd: sql<number>`COALESCE(SUM(${geminiUsage.estimatedCostUsd}), 0)`,
      calls: sql<number>`COUNT(*)`,
      erroredCalls: sql<number>`SUM(CASE WHEN ${geminiUsage.status} = 'error' THEN 1 ELSE 0 END)`,
    })
    .from(geminiUsage)
    .leftJoin(agentRuns, eq(agentRuns.id, geminiUsage.agentRunId))
    .where(gte(geminiUsage.timestamp, since))
    .groupBy(sql`COALESCE(${agentRuns.agent}, '(unattributed)')`, geminiUsage.provider, geminiUsage.model)
    .orderBy(desc(sql`COALESCE(SUM(${geminiUsage.estimatedCostUsd}), 0)`));

  return rows.map((r) => ({
    agent: r.agent,
    agentLabel: r.agent === "(unattributed)" ? "(unattributed)" : labelForAgent(r.agent),
    provider: r.provider,
    model: r.model,
    tokens: Number(r.tokens),
    costUsd: Number(r.costUsd),
    calls: Number(r.calls),
    erroredCalls: Number(r.erroredCalls),
  }));
}

export interface SurfaceCoverage {
  agent: string;
  label: string;
  kind: SurfaceKind;
  cadence: string;
  file: string;
  purpose: string;
  runs: number;
  lastRunAt: Date | null;
  instrumented: boolean;
}

/**
 * Which declared surfaces have ever written a run.
 *
 * This is what stops an empty queue from reading as a healthy one. A surface
 * with zero runs is reported as uninstrumented, loudly, rather than simply
 * being absent from the list.
 */
export async function coverage(env: Env): Promise<SurfaceCoverage[]> {
  const db = drizzle(env.DB);
  const rows = await db
    .select({
      agent: agentRuns.agent,
      runs: sql<number>`COUNT(*)`,
      lastRunAt: sql<number>`MAX(${agentRuns.createdAt})`,
    })
    .from(agentRuns)
    .groupBy(agentRuns.agent);

  const seen = new Map(rows.map((r) => [r.agent, r]));

  return AGENT_SURFACES.map((s) => {
    const hit = seen.get(s.agent);
    return {
      agent: s.agent,
      label: s.label,
      kind: s.kind,
      cadence: s.cadence,
      file: s.file,
      purpose: s.purpose,
      runs: Number(hit?.runs ?? 0),
      lastRunAt: hit?.lastRunAt ? new Date(Number(hit.lastRunAt) * 1000) : null,
      instrumented: Boolean(hit),
    };
  });
}

export interface RunawayFlag {
  agent: string;
  agentLabel: string;
  lastHour: number;
  baselinePerHour: number;
  ratio: number;
}

/**
 * Runs-per-hour for each agent against its own 7-day trailing baseline.
 *
 * The `RemodelOrchestrator` runaway produced ~1M schedule rows and roughly
 * $50/day for weeks and was found on a billing invoice. The circuit breaker
 * added in #181 now hard-stops a confirmed loop; this makes the ramp visible
 * BEFORE it trips, which is the part that was missing.
 *
 * A baseline below one run/hour is floored at 1 so a normally-idle agent firing
 * three times in an hour does not read as a 300x incident.
 */
export async function detectRunaways(env: Env, now = new Date()): Promise<RunawayFlag[]> {
  const db = drizzle(env.DB);
  const hourAgo = new Date(now.getTime() - HOUR_MS);
  const weekAgo = new Date(now.getTime() - 7 * 24 * HOUR_MS);

  const [recent, baseline] = await Promise.all([
    db
      .select({ agent: agentRuns.agent, n: sql<number>`COUNT(*)` })
      .from(agentRuns)
      .where(gte(agentRuns.createdAt, hourAgo))
      .groupBy(agentRuns.agent),
    db
      .select({ agent: agentRuns.agent, n: sql<number>`COUNT(*)` })
      .from(agentRuns)
      // `lt(...)`, not a raw sql`` comparison: the column is mode:"timestamp",
      // so drizzle must serialize the Date to seconds itself. Interpolating a
      // Date into a raw template bypasses that and D1 rejects the bind.
      .where(and(gte(agentRuns.createdAt, weekAgo), lt(agentRuns.createdAt, hourAgo)))
      .groupBy(agentRuns.agent),
  ]);

  const baseByAgent = new Map(baseline.map((b) => [b.agent, Number(b.n) / (7 * 24)]));

  return recent
    .map((r) => {
      const perHour = Math.max(baseByAgent.get(r.agent) ?? 0, 1);
      const lastHour = Number(r.n);
      return {
        agent: r.agent,
        agentLabel: labelForAgent(r.agent),
        lastHour,
        baselinePerHour: Number(perHour.toFixed(2)),
        ratio: Number((lastHour / perHour).toFixed(2)),
      };
    })
    .filter((f) => f.ratio >= 5 && f.lastHour >= 10)
    .sort((a, b) => b.ratio - a.ratio);
}
