/**
 * @fileoverview Agent Ops API — `/api/admin/agents`
 *
 * The first readers of the `agent_runs` ledger, which shipped with none.
 * Gated by `requireAccessAuth` through the `/api/admin/*` middleware registered
 * in `src/backend/api/index.ts` — no auth code lives here.
 *
 *   GET   /api/admin/agents/overview        Counts, spend, breaker state, runaways.
 *   GET   /api/admin/agents/runs            Queue list (status/agent/since/limit).
 *   GET   /api/admin/agents/runs/:id        One run: steps, tool calls, lineage, cost.
 *   POST  /api/admin/agents/runs/:id/retry  New run, parent_run_id set.
 *   POST  /api/admin/agents/runs/:id/cancel Mark cancelled.
 *   POST  /api/admin/agents/runs/:id/approve  needs_approval → running (HITL).
 *   GET   /api/admin/agents/failures        Grouped by (error_code, agent, operation).
 *   GET   /api/admin/agents/usage           Spend by agent / provider / model.
 *   GET   /api/admin/agents/coverage        Which declared surfaces are wired.
 *
 * Plain Hono rather than @hono/zod-openapi, matching its two closest siblings
 * (`admin-plans.ts`, `mcp-ops.ts`) — these are internal admin reads consumed by
 * one first-party island, not a public contract.
 */
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";

import { agentRuns } from "@backend/db";
import { AGENT_SURFACES } from "@backend/services/agent-registry";
import { startRun } from "@backend/services/agent-runs";
import {
  coverage,
  detectRunaways,
  getRun,
  groupFailures,
  listRuns,
  spendByAgent,
} from "@backend/services/agent-runs-query";
import { countRunsByStatus } from "@backend/services/agent-run-retention";
import { getAiGatewayUsage } from "@backend/services/ai-gateway/analytics";
import {
  METERED_PROVIDERS,
  canSpend,
  cycleStart,
  getMeteringConfig,
} from "@backend/services/usage/metering";

export const adminAgentsRouter = new Hono<{ Bindings: Env }>();

/** Statuses a client may filter on. Anything else is rejected rather than ignored. */
const RUN_STATUSES = [
  "queued",
  "running",
  "needs_approval",
  "succeeded",
  "failed",
  "cancelled",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `?since=24h|7d|30d` → Date. Defaults to 24h; caps at 90d (the retention ceiling). */
function parseSince(raw: string | undefined, fallbackHours = 24): Date {
  const now = Date.now();
  if (!raw) return new Date(now - fallbackHours * 60 * 60 * 1000);
  const m = /^(\d+)([hd])$/.exec(raw.trim());
  if (!m) return new Date(now - fallbackHours * 60 * 60 * 1000);
  const n = Number(m[1]);
  const ms = m[2] === "h" ? n * 60 * 60 * 1000 : n * DAY_MS;
  return new Date(now - Math.min(ms, 90 * DAY_MS));
}

function parseId(raw: string | undefined): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ── Reads ────────────────────────────────────────────────────────────────────

adminAgentsRouter.get("/overview", async (c) => {
  const since = parseSince(c.req.query("since"));

  const [counts, runaways, cov, config] = await Promise.all([
    countRunsByStatus(c.env),
    detectRunaways(c.env),
    coverage(c.env),
    getMeteringConfig(c.env),
  ]);

  // Breaker state per provider. `canSpend` fails closed, so a read error here
  // surfaces as "blocked" rather than a falsely reassuring "fine".
  const providers = await Promise.all(
    METERED_PROVIDERS.map(async (provider) => {
      const d = await canSpend(c.env, provider);
      return {
        provider,
        allowed: d.allowed,
        spendUsd: d.spendUsd,
        ceilingUsd: d.ceilingUsd,
        reason: d.reason,
        percent: d.ceilingUsd > 0 ? Math.round((d.spendUsd / d.ceilingUsd) * 100) : null,
      };
    }),
  );

  const instrumented = cov.filter((s) => s.instrumented).length;

  return c.json({
    success: true,
    since: since.toISOString(),
    counts,
    runaways,
    providers,
    cycleStart: cycleStart(config.cycleAnchorDay).toISOString(),
    coverage: {
      instrumented,
      total: AGENT_SURFACES.length,
      percent: Math.round((instrumented / AGENT_SURFACES.length) * 100),
      missing: cov.filter((s) => !s.instrumented).map((s) => s.agent),
    },
  });
});

adminAgentsRouter.get("/runs", async (c) => {
  const statusRaw = c.req.query("status");
  const status = statusRaw
    ? statusRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  const invalid = status?.filter((s) => !RUN_STATUSES.includes(s as (typeof RUN_STATUSES)[number]));
  if (invalid?.length) {
    return c.json(
      { success: false, error: `Unknown status: ${invalid.join(", ")}`, allowed: RUN_STATUSES },
      400,
    );
  }

  const runs = await listRuns(c.env, {
    // Narrowed by the check above; the cast documents that, rather than
    // widening the query layer's type to plain string[].
    status: status as Parameters<typeof listRuns>[1] extends { status?: infer S } ? S : never,
    agent: c.req.query("agent") || undefined,
    since: parseSince(c.req.query("since")),
    limit: Number(c.req.query("limit")) || undefined,
  });

  return c.json({ success: true, count: runs.length, runs });
});

adminAgentsRouter.get("/runs/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ success: false, error: "Invalid run id" }, 400);

  const detail = await getRun(c.env, id);
  if (!detail) return c.json({ success: false, error: `Run ${id} not found` }, 404);

  return c.json({ success: true, ...detail });
});

adminAgentsRouter.get("/failures", async (c) => {
  const since = parseSince(c.req.query("since"), 24 * 7);
  const groups = await groupFailures(c.env, since);
  return c.json({
    success: true,
    since: since.toISOString(),
    count: groups.length,
    totalRuns: groups.reduce((n, g) => n + g.count, 0),
    groups,
  });
});

adminAgentsRouter.get("/usage", async (c) => {
  const config = await getMeteringConfig(c.env);
  const since = c.req.query("since")
    ? parseSince(c.req.query("since"))
    : cycleStart(config.cycleAnchorDay);

  // Reconciliation source. Cloudflare's own AI Gateway rollup is independent
  // of our ledger, so a large gap between the two means instrumentation is
  // missing — which is exactly the failure this page must not hide. It
  // degrades to {available:false, reason} rather than throwing.
  const [rows, gateway] = await Promise.all([
    spendByAgent(c.env, since),
    getAiGatewayUsage(c.env).catch((err) => ({
      available: false as const,
      reason: err instanceof Error ? err.message : String(err),
      gatewayId: c.env.AI_GATEWAY_ID ?? "",
      month: "",
      totalRequests: 0,
      cachedRequests: 0,
      erroredRequests: 0,
      byModel: [],
    })),
  ]);
  const totalCostUsd = rows.reduce((n, r) => n + r.costUsd, 0);
  const totalTokens = rows.reduce((n, r) => n + r.tokens, 0);
  const ledgerCalls = rows.reduce((n, r) => n + r.calls, 0);

  return c.json({
    success: true,
    since: since.toISOString(),
    totalCostUsd,
    totalTokens,
    // Dollars per million tokens. Null rather than a divide-by-zero 0 when no
    // tokens were reported — "unknown" and "free" must stay distinguishable.
    unitCostPerMillion: totalTokens > 0 ? (totalCostUsd / totalTokens) * 1_000_000 : null,
    ledgerCalls,
    // Independent second opinion. `driftPct` is null when the gateway is
    // unavailable or reports nothing — an unknown drift must stay
    // distinguishable from a zero drift.
    gateway: {
      available: gateway.available,
      reason: gateway.reason ?? null,
      month: gateway.month,
      totalRequests: gateway.totalRequests,
      erroredRequests: gateway.erroredRequests,
      driftPct:
        gateway.available && gateway.totalRequests > 0
          ? Math.round(((ledgerCalls - gateway.totalRequests) / gateway.totalRequests) * 100)
          : null,
    },
    rows,
  });
});

adminAgentsRouter.get("/coverage", async (c) => {
  const surfaces = await coverage(c.env);
  return c.json({
    success: true,
    instrumented: surfaces.filter((s) => s.instrumented).length,
    total: surfaces.length,
    surfaces,
  });
});

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Retry a run.
 *
 * Inserts a NEW run with `parent_run_id` set and `attempt` incremented; the
 * failed row is never mutated. That is what lets the detail page render
 * "attempt 3 of 3" as three real runs — each with its own error and tool calls —
 * instead of one row that overwrote its own history twice.
 *
 * NOTE: this records the retry intent in the ledger. Re-dispatching the
 * underlying work (a Workflow instance, a queue task) is per-surface and lands
 * with the queue UI in P3; a retry created here is visible as `queued`.
 */
adminAgentsRouter.post("/runs/:id/retry", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ success: false, error: "Invalid run id" }, 400);

  const db = drizzle(c.env.DB);
  const [parent] = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
  if (!parent) return c.json({ success: false, error: `Run ${id} not found` }, 404);

  if (parent.status === "running" || parent.status === "queued") {
    return c.json(
      { success: false, error: `Run ${id} is still ${parent.status} — cancel it before retrying.` },
      409,
    );
  }

  const retry = await startRun(c.env, {
    agent: parent.agent,
    operation: parent.operation,
    targetType: parent.targetType ?? undefined,
    targetId: parent.targetId ?? undefined,
    targetLabel: parent.targetLabel ?? undefined,
    input: parent.inputJson ? safeParse(parent.inputJson) : undefined,
    triggeredBy: "user",
    parentRunId: parent.id,
    attempt: parent.attempt + 1,
  });

  if (retry.id === null) {
    return c.json({ success: false, error: "Failed to open the retry run" }, 500);
  }

  return c.json({ success: true, runId: retry.id, parentRunId: parent.id, attempt: parent.attempt + 1 });
});

adminAgentsRouter.post("/runs/:id/cancel", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ success: false, error: "Invalid run id" }, 400);

  const db = drizzle(c.env.DB);
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
  if (!run) return c.json({ success: false, error: `Run ${id} not found` }, 404);

  // Cancelling a settled run would rewrite history for no benefit.
  if (!["queued", "running", "needs_approval"].includes(run.status)) {
    return c.json({ success: false, error: `Run ${id} is already ${run.status}` }, 409);
  }

  const endedAt = new Date();
  await db
    .update(agentRuns)
    .set({
      status: "cancelled",
      endedAt,
      durationMs: run.startedAt ? endedAt.getTime() - run.startedAt.getTime() : null,
    })
    .where(eq(agentRuns.id, id));

  return c.json({ success: true, runId: id, status: "cancelled" });
});

adminAgentsRouter.post("/runs/:id/approve", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ success: false, error: "Invalid run id" }, 400);

  const db = drizzle(c.env.DB);
  const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
  if (!run) return c.json({ success: false, error: `Run ${id} not found` }, 404);

  if (run.status !== "needs_approval") {
    return c.json(
      { success: false, error: `Run ${id} is ${run.status}, not awaiting approval` },
      409,
    );
  }

  await db
    .update(agentRuns)
    .set({ status: "running", endedAt: null, durationMs: null })
    .where(eq(agentRuns.id, id));

  return c.json({ success: true, runId: id, status: "running" });
});

/** Parse stored JSON without letting a malformed blob 500 the retry. */
function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
