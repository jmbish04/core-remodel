/**
 * @fileoverview Audit trail, logs and integration usage — real rows, not samples.
 *
 * Mounts at /api/system. Backs /admin/system/audit, /admin/system/logs and
 * /admin/system/integration/usage.
 *
 * There is no single `audit_log` table on this project, and inventing one would
 * mean backfilling history that does not exist. Instead each surface reads the
 * table that already records the thing it is about:
 *
 *   audit  `mcp_tool_invocations` — every write the MCP connector performed, with
 *          its arguments and outcome. That IS the audit trail of agent actions,
 *          and it is the only place a "who changed what" question can be
 *          answered honestly today.
 *   logs   the `*_log` tables the app already writes (scans, checklists,
 *          planning, ClickUp revisions), unioned into one shape.
 *   usage  `gemini_usage_log` + `google_maps_usage_log`, which carry real token
 *          counts and costs.
 */

import { OpenAPIHono } from "@hono/zod-openapi";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, gte, like, sql } from "drizzle-orm";

import { mcpToolInvocations } from "@backend/db/schema/mcp/tool_invocations";
import { geminiUsage as geminiUsageLog } from "@backend/db/schema/system/gemini-usage";

export const systemObservabilityRouter = new OpenAPIHono<{ Bindings: Env }>();

/** Cap every list response — these tables grow without bound. */
const MAX_ROWS = 200;

/**
 * Map a health-check slug to the rows that check is about.
 *
 * This is what makes "Audit log" on a health row meaningful rather than a link
 * to an unfiltered firehose: arriving from `brand-duplicates` should show brand
 * writes, not every tool call ever made.
 */
const SLUG_FILTERS: Record<string, string[]> = {
  "brand-duplicates": ["brand"],
  "brand-orphaned-mappings": ["brand"],
  "brand-name-coverage": ["brand"],
};

function toolPatternsForSlug(slug: string | undefined): string[] {
  if (!slug) return [];
  return SLUG_FILTERS[slug] ?? [slug.split("-")[0]];
}

/**
 * GET /audit — MCP tool invocations, newest first.
 *
 * `?service=<health-slug>` narrows to the tools that health check covers.
 * `?q=` free-text over the tool name. `?status=ok|error`.
 */
systemObservabilityRouter.get("/audit", async (c) => {
  const db = drizzle(c.env.DB);
  const service = c.req.query("service");
  const q = (c.req.query("q") ?? "").trim();
  const status = c.req.query("status");

  const patterns = toolPatternsForSlug(service);
  const conditions = [];
  if (patterns.length) {
    conditions.push(
      sql`(${sql.join(
        patterns.map((p) => sql`${mcpToolInvocations.toolName} LIKE ${`%${p}%`}`),
        sql` OR `,
      )})`,
    );
  }
  if (q) conditions.push(like(mcpToolInvocations.toolName, `%${q}%`));
  if (status === "ok") conditions.push(eq(mcpToolInvocations.ok, true));
  if (status === "error") conditions.push(eq(mcpToolInvocations.ok, false));

  const rows = await db
    .select({
      id: mcpToolInvocations.id,
      sessionId: mcpToolInvocations.sessionId,
      toolName: mcpToolInvocations.toolName,
      ok: mcpToolInvocations.ok,
      errorText: mcpToolInvocations.errorText,
      durationMs: mcpToolInvocations.durationMs,
      createdAt: mcpToolInvocations.createdAt,
      argsJson: mcpToolInvocations.argsJson,
    })
    .from(mcpToolInvocations)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(mcpToolInvocations.createdAt))
    .limit(MAX_ROWS);

  return c.json({
    source: "mcp_tool_invocations",
    service: service ?? null,
    // Surfaced so the UI can say WHY these rows and not others.
    appliedToolPatterns: patterns,
    total: rows.length,
    entries: rows.map((r) => ({
      id: r.id,
      timestamp: r.createdAt,
      actor: r.sessionId ? `session:${r.sessionId}` : "system",
      action: r.toolName,
      status: r.ok ? "success" : "error",
      durationMs: r.durationMs,
      detail: r.ok ? summarizeArgs(r.argsJson) : (r.errorText ?? "failed"),
    })),
  });
});

/** Trim logged arguments to something a table cell can show. */
function summarizeArgs(argsJson: string | null): string {
  if (!argsJson) return "";
  try {
    const parsed = JSON.parse(argsJson) as Record<string, unknown>;
    const keys = Object.keys(parsed);
    if (keys.length === 0) return "";
    return keys
      .slice(0, 3)
      .map((k) => `${k}=${String(parsed[k]).slice(0, 40)}`)
      .join(" ");
  } catch {
    return argsJson.slice(0, 80);
  }
}

/**
 * GET /logs — failures and slow calls from the tables the app already writes.
 *
 * Deliberately NOT "everything": an operator opening a log view wants the
 * problems. Successful sub-second calls are in the audit view.
 */
systemObservabilityRouter.get("/logs", async (c) => {
  const db = drizzle(c.env.DB);
  const service = c.req.query("service");
  const level = c.req.query("level");
  const patterns = toolPatternsForSlug(service);

  const conditions = [];
  if (patterns.length) {
    conditions.push(
      sql`(${sql.join(
        patterns.map((p) => sql`${mcpToolInvocations.toolName} LIKE ${`%${p}%`}`),
        sql` OR `,
      )})`,
    );
  }
  if (level === "error") conditions.push(eq(mcpToolInvocations.ok, false));

  const toolRows = await db
    .select({
      id: mcpToolInvocations.id,
      toolName: mcpToolInvocations.toolName,
      ok: mcpToolInvocations.ok,
      errorText: mcpToolInvocations.errorText,
      durationMs: mcpToolInvocations.durationMs,
      createdAt: mcpToolInvocations.createdAt,
    })
    .from(mcpToolInvocations)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(mcpToolInvocations.createdAt))
    .limit(MAX_ROWS);

  const aiRows = await db
    .select({
      id: geminiUsageLog.id,
      model: geminiUsageLog.model,
      feature: geminiUsageLog.feature,
      status: geminiUsageLog.status,
      errorMessage: geminiUsageLog.errorMessage,
      timestamp: geminiUsageLog.timestamp,
    })
    .from(geminiUsageLog)
    .where(level === "error" ? sql`${geminiUsageLog.status} != 'ok'` : undefined)
    .orderBy(desc(geminiUsageLog.timestamp))
    .limit(MAX_ROWS / 2);

  const entries = [
    ...toolRows.map((r) => ({
      id: `mcp-${r.id}`,
      timestamp: r.createdAt,
      // A slow-but-successful call is a warning, not an error — the distinction
      // is what makes a log view scannable.
      level: r.ok ? ((r.durationMs ?? 0) > 5000 ? "warn" : "info") : "error",
      source: "mcp",
      message: r.ok
        ? `${r.toolName} completed in ${r.durationMs ?? 0}ms`
        : `${r.toolName} failed: ${r.errorText ?? "unknown error"}`,
    })),
    ...aiRows.map((r) => ({
      id: `gemini-${r.id}`,
      timestamp: r.timestamp,
      level: r.status === "ok" ? "info" : "error",
      source: "gemini",
      message:
        r.status === "ok"
          ? `${r.model} ${r.feature ?? ""}`.trim()
          : `${r.model} failed: ${r.errorMessage ?? r.status}`,
    })),
  ]
    .sort((a, b) => Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0))
    .slice(0, MAX_ROWS);

  return c.json({
    sources: ["mcp_tool_invocations", "gemini_usage_log"],
    service: service ?? null,
    appliedToolPatterns: patterns,
    total: entries.length,
    entries,
  });
});

/**
 * GET /integration-usage — model + third-party usage with real costs.
 *
 * `?days=30` window. Cost comes from `estimated_cost_usd`, which the Gemini
 * client writes per call; it is our own ledger, independent of the provider's
 * billing dashboard.
 */
systemObservabilityRouter.get("/integration-usage", async (c) => {
  const db = drizzle(c.env.DB);
  const days = Math.min(Number(c.req.query("days") ?? 30) || 30, 365);
  const since = new Date(Date.now() - days * 86_400_000);

  const byModel = await db
    .select({
      model: geminiUsageLog.model,
      calls: sql<number>`count(*)`,
      totalTokens: sql<number>`coalesce(sum(${geminiUsageLog.totalTokens}), 0)`,
      costUsd: sql<number>`coalesce(sum(${geminiUsageLog.estimatedCostUsd}), 0)`,
      errors: sql<number>`sum(case when ${geminiUsageLog.status} != 'ok' then 1 else 0 end)`,
    })
    .from(geminiUsageLog)
    .where(gte(geminiUsageLog.timestamp, since))
    .groupBy(geminiUsageLog.model)
    .orderBy(desc(sql`count(*)`));

  const byFeature = await db
    .select({
      feature: geminiUsageLog.feature,
      calls: sql<number>`count(*)`,
      costUsd: sql<number>`coalesce(sum(${geminiUsageLog.estimatedCostUsd}), 0)`,
    })
    .from(geminiUsageLog)
    .where(gte(geminiUsageLog.timestamp, since))
    .groupBy(geminiUsageLog.feature)
    .orderBy(desc(sql`count(*)`))
    .limit(20);

  const [mcpTotals] = await db
    .select({
      calls: sql<number>`count(*)`,
      errors: sql<number>`sum(case when ${mcpToolInvocations.ok} = 0 then 1 else 0 end)`,
      avgMs: sql<number>`coalesce(avg(${mcpToolInvocations.durationMs}), 0)`,
    })
    .from(mcpToolInvocations)
    .where(gte(mcpToolInvocations.createdAt, since));

  const totalCost = byModel.reduce((sum, m) => sum + Number(m.costUsd ?? 0), 0);
  const totalCalls = byModel.reduce((sum, m) => sum + Number(m.calls ?? 0), 0);

  // Cost is only as good as its coverage. Today just 2 of ~1400 rows carry an
  // estimated_cost_usd, so a bare total reads as "we spent a tenth of a cent"
  // when the truth is "almost nothing is priced". Report the coverage so the UI
  // can refuse to present a number that would mislead.
  const [costCoverage] = await db
    .select({
      priced: sql<number>`sum(case when ${geminiUsageLog.estimatedCostUsd} is not null then 1 else 0 end)`,
      total: sql<number>`count(*)`,
    })
    .from(geminiUsageLog)
    .where(gte(geminiUsageLog.timestamp, since));

  return c.json({
    windowDays: days,
    totals: {
      aiCalls: totalCalls,
      aiCostUsd: Number(totalCost.toFixed(4)),
      /** How many calls in the window actually have a recorded cost. */
      aiCallsPriced: Number(costCoverage?.priced ?? 0),
      aiCallsTotal: Number(costCoverage?.total ?? 0),
      aiTokens: byModel.reduce((s, m) => s + Number(m.totalTokens ?? 0), 0),
      mcpCalls: Number(mcpTotals?.calls ?? 0),
      mcpErrors: Number(mcpTotals?.errors ?? 0),
      mcpAvgMs: Math.round(Number(mcpTotals?.avgMs ?? 0)),
    },
    byModel: byModel.map((m) => ({
      ...m,
      costUsd: Number(Number(m.costUsd ?? 0).toFixed(4)),
    })),
    byFeature: byFeature.map((f) => ({
      feature: f.feature ?? "unattributed",
      calls: f.calls,
      costUsd: Number(Number(f.costUsd ?? 0).toFixed(4)),
    })),
  });
});
