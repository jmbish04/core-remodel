/**
 * @fileoverview The health session runner.
 *
 * One "session" = one click of Run on `/admin/system/health`, one `POST /api/health/run`,
 * or one MCP invocation. A session:
 *   1. syncs the catalogue — every probe's self-description is upserted into
 *      `health_test_def` (and its binding types into the vocabulary + mapping
 *      tables), so the runbook on the dashboard is always the code's own words;
 *   2. runs every probe concurrently, each individually timed and time-boxed;
 *   3. writes one `health_results` row per probe, all sharing one `session_uuid`
 *      and one `timestamp`.
 *
 * D1 has no transactions — every multi-row write here goes through `db.batch()`,
 * never `db.transaction()` (which throws 7500 on D1 and always has).
 */

import {
  healthBindingTypes,
  healthResults,
  healthTestBindingTypes,
  healthTestDef,
} from "@backend/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { ALL_HEALTH_PROBES, HEALTH_MODULE_GROUPS, PROBE_GROUP_BY_NAME } from "./probes";
import type { HealthProbe, HealthResult } from "./types";

/** A probe that hangs must not hang the session. */
const PROBE_TIMEOUT_MS = 10_000;

export type HealthTrigger = "ui" | "api" | "mcp" | "cron";

export interface HealthProbeRun {
  name: string;
  displayName: string;
  groupId: string;
  severity: string;
  isBillingRisk: boolean;
  result: HealthResult;
  details: string;
  durationMs: number;
}

export interface HealthSessionResult {
  sessionUuid: string;
  timestamp: string;
  triggeredBy: HealthTrigger;
  /** Worst outcome across all probes: any FAILURE → FAILURE, else any DEGRADED → DEGRADED. */
  overall: HealthResult;
  counts: { success: number; degraded: number; failure: number };
  totalDurationMs: number;
  runs: HealthProbeRun[];
}

/** Roll several outcomes up into one. */
export function rollUp(results: HealthResult[]): HealthResult {
  if (results.includes("FAILURE")) return "FAILURE";
  if (results.includes("DEGRADED")) return "DEGRADED";
  return "SUCCESS";
}

/** Run one probe, converting a throw or a hang into a FAILURE row. */
async function runProbe(probe: HealthProbe, env: Env): Promise<HealthProbeRun> {
  const t0 = Date.now();
  const base = {
    name: probe.name,
    displayName: probe.displayName,
    groupId: PROBE_GROUP_BY_NAME[probe.name] ?? "other",
    severity: probe.severity,
    isBillingRisk: probe.isBillingRisk,
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      probe.run(env),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`probe timed out after ${PROBE_TIMEOUT_MS}ms`)),
          PROBE_TIMEOUT_MS,
        );
      }),
    ]);
    return { ...base, ...outcome, durationMs: Date.now() - t0 };
  } catch (e) {
    return {
      ...base,
      result: "FAILURE",
      details: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - t0,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Upsert every probe's self-description into `health_test_def`, deactivate rows
 * whose probe no longer exists in code, and reconcile the binding-type
 * vocabulary + mappings. Returns `name → health_test_def.id`.
 *
 * Deactivate rather than delete: `health_results` FKs these rows, so history for
 * a retired probe must stay readable.
 */
export async function syncHealthCatalogue(env: Env): Promise<Map<string, number>> {
  const db = drizzle(env.DB);
  const now = new Date();

  // 1. Definitions — upsert by the natural key (`name`).
  const defStmts = ALL_HEALTH_PROBES.map((p) =>
    db
      .insert(healthTestDef)
      .values({
        name: p.name,
        displayName: p.displayName,
        description: p.description,
        healthTsFilepath: p.healthTsFilepath,
        whatSuccessMeans: p.whatSuccessMeans,
        whatFailureMeans: p.whatFailureMeans,
        troubleshootingSteps: p.troubleshootingSteps,
        devOpsPlaybook: p.devOpsPlaybook,
        isBillingRisk: p.isBillingRisk,
        severity: p.severity,
        isActive: true,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: healthTestDef.name,
        set: {
          displayName: p.displayName,
          description: p.description,
          healthTsFilepath: p.healthTsFilepath,
          whatSuccessMeans: p.whatSuccessMeans,
          whatFailureMeans: p.whatFailureMeans,
          troubleshootingSteps: p.troubleshootingSteps,
          devOpsPlaybook: p.devOpsPlaybook,
          isBillingRisk: p.isBillingRisk,
          severity: p.severity,
          isActive: true,
          updatedAt: now,
        },
      }),
  );

  // 2. Binding-type vocabulary — a definition table, never a comma-separated column.
  const bindingNames = [...new Set(ALL_HEALTH_PROBES.flatMap((p) => p.bindingTypesTested))].sort();
  const bindingStmts = bindingNames.map((name) =>
    db
      .insert(healthBindingTypes)
      .values({ name, description: BINDING_TYPE_BLURBS[name] ?? null, isActive: true })
      .onConflictDoNothing({ target: healthBindingTypes.name }),
  );

  const stmts = [...defStmts, ...bindingStmts];
  if (stmts.length > 0) {
    await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
  }

  const defRows = await db
    .select({ id: healthTestDef.id, name: healthTestDef.name, isActive: healthTestDef.isActive })
    .from(healthTestDef);
  const bindingRows = await db
    .select({ id: healthBindingTypes.id, name: healthBindingTypes.name })
    .from(healthBindingTypes);

  const defIdByName = new Map(defRows.map((r) => [r.name, r.id]));
  const bindingIdByName = new Map(bindingRows.map((r) => [r.name, r.id]));

  // 3. Retire catalogue rows whose probe was deleted from code.
  const liveNames = new Set(ALL_HEALTH_PROBES.map((p) => p.name));
  const staleIds = defRows.filter((r) => r.isActive && !liveNames.has(r.name)).map((r) => r.id);
  if (staleIds.length > 0) {
    await db
      .update(healthTestDef)
      .set({ isActive: false, updatedAt: now })
      .where(inArray(healthTestDef.id, staleIds));
  }

  // 4. Reconcile mappings, but only for probes whose binding set actually changed
  //    — a full delete+reinsert on every run would churn the table for nothing.
  const existingMappings = await db
    .select({
      defId: healthTestBindingTypes.healthTestDefId,
      bindingId: healthTestBindingTypes.healthBindingTypeId,
    })
    .from(healthTestBindingTypes);
  const existingByDef = new Map<number, Set<number>>();
  for (const m of existingMappings) {
    const set = existingByDef.get(m.defId) ?? new Set<number>();
    set.add(m.bindingId);
    existingByDef.set(m.defId, set);
  }

  const mappingStmts: unknown[] = [];
  for (const probe of ALL_HEALTH_PROBES) {
    const defId = defIdByName.get(probe.name);
    if (defId === undefined) continue;
    const wantIds = new Set(
      probe.bindingTypesTested
        .map((b) => bindingIdByName.get(b))
        .filter((id): id is number => id !== undefined),
    );
    const haveIds = existingByDef.get(defId) ?? new Set<number>();

    for (const id of wantIds) {
      if (!haveIds.has(id)) {
        mappingStmts.push(
          db
            .insert(healthTestBindingTypes)
            .values({ healthTestDefId: defId, healthBindingTypeId: id }),
        );
      }
    }
    for (const id of haveIds) {
      if (!wantIds.has(id)) {
        mappingStmts.push(
          db
            .delete(healthTestBindingTypes)
            .where(
              and(
                eq(healthTestBindingTypes.healthTestDefId, defId),
                eq(healthTestBindingTypes.healthBindingTypeId, id),
              ),
            ),
        );
      }
    }
  }
  if (mappingStmts.length > 0) {
    const batch = mappingStmts as [unknown, ...unknown[]];
    await db.batch(batch as Parameters<typeof db.batch>[0]);
  }

  return defIdByName;
}

/** One-line descriptions for the binding-type vocabulary rows. */
const BINDING_TYPE_BLURBS: Record<string, string> = {
  d1: "Cloudflare D1 — the serverless SQLite databases (DB, TESLA_DB).",
  kv: "Workers KV — eventually-consistent key/value (CACHE, SESSIONS, OAUTH_KV).",
  r2: "R2 object storage — artifacts, documents, derived media.",
  vectorize: "Vectorize indexes used for semantic search and research recall.",
  workers_ai: "The Workers AI binding — on-platform model inference.",
  durable_object: "Durable Object namespaces — stateful agents and realtime sessions.",
  workflow: "Cloudflare Workflows — durable multi-step background jobs.",
  secrets_store: "Secrets Store bindings — remote-only credentials with no local fallback.",
  ai_gateway: "AI Gateway — the logging/caching proxy in front of model providers.",
  images: "Cloudflare Images — upload, transform and delivery.",
  email: "Email routing — the inbound handler and the send_email binding.",
  assets: "The static asset binding serving the built Astro frontend.",
  worker_loader: "Dynamic Worker loader binding.",
  external_api: "A third-party HTTP API reached over the network (credential presence only).",
};

/**
 * Run every probe and persist the session.
 *
 * Never throws for a probe failure. A persistence failure is logged and surfaced
 * on the result (`persisted: false` is not modelled — the live results are still
 * returned, because a broken audit trail must not hide a broken system).
 */
export async function runHealthSession(
  env: Env,
  triggeredBy: HealthTrigger = "api",
): Promise<HealthSessionResult> {
  const t0 = Date.now();
  const sessionUuid = crypto.randomUUID();
  const timestamp = new Date();

  // Catalogue sync first: a result row needs its definition's id, and the
  // dashboard's runbook should describe the code that is about to run.
  let defIdByName: Map<string, number>;
  try {
    defIdByName = await syncHealthCatalogue(env);
  } catch (e) {
    console.error("[health/run] catalogue sync failed:", e);
    defIdByName = new Map();
  }

  const runs = await Promise.all(ALL_HEALTH_PROBES.map((p) => runProbe(p, env)));

  const counts = {
    success: runs.filter((r) => r.result === "SUCCESS").length,
    degraded: runs.filter((r) => r.result === "DEGRADED").length,
    failure: runs.filter((r) => r.result === "FAILURE").length,
  };

  try {
    const db = drizzle(env.DB);
    const stmts = runs
      .filter((r) => defIdByName.has(r.name))
      .map((r) =>
        db.insert(healthResults).values({
          timestamp,
          sessionUuid,
          healthTestDefId: defIdByName.get(r.name) as number,
          healthTestResult: r.result,
          healthTestResultDetails: r.details.slice(0, 4000),
          durationMs: r.durationMs,
          triggeredBy,
        }),
      );
    if (stmts.length > 0) {
      await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
    }
  } catch (e) {
    console.error("[health/run] failed to persist health_results rows:", e);
  }

  return {
    sessionUuid,
    timestamp: timestamp.toISOString(),
    triggeredBy,
    overall: rollUp(runs.map((r) => r.result)),
    counts,
    totalDurationMs: Date.now() - t0,
    runs,
  };
}

/** The catalogue as the dashboard wants it: groups → probes → full runbook. */
export async function getHealthCatalogue(env: Env) {
  const db = drizzle(env.DB);
  const defs = await db.select().from(healthTestDef).where(eq(healthTestDef.isActive, true));
  const defById = new Map(defs.map((d) => [d.name, d]));

  return HEALTH_MODULE_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    blurb: group.blurb,
    tests: group.probes.map((p) => ({
      name: p.name,
      displayName: p.displayName,
      description: p.description,
      healthTsFilepath: p.healthTsFilepath,
      bindingTypesTested: p.bindingTypesTested,
      whatSuccessMeans: p.whatSuccessMeans,
      whatFailureMeans: p.whatFailureMeans,
      troubleshootingSteps: p.troubleshootingSteps,
      devOpsPlaybook: p.devOpsPlaybook,
      isBillingRisk: p.isBillingRisk,
      severity: p.severity,
      defId: defById.get(p.name)?.id ?? null,
    })),
  }));
}

/**
 * The most recent persisted session, reshaped like a live run. Used to paint the
 * dashboard on load and to answer the header badge without probing anything.
 */
export async function getLatestHealthSession(env: Env): Promise<HealthSessionResult | null> {
  const db = drizzle(env.DB);

  const [latest] = await db
    .select({ sessionUuid: healthResults.sessionUuid, timestamp: healthResults.timestamp })
    .from(healthResults)
    .orderBy(desc(healthResults.timestamp), desc(healthResults.id))
    .limit(1);
  if (!latest) return null;

  const rows = await db
    .select({
      name: healthTestDef.name,
      displayName: healthTestDef.displayName,
      severity: healthTestDef.severity,
      isBillingRisk: healthTestDef.isBillingRisk,
      result: healthResults.healthTestResult,
      details: healthResults.healthTestResultDetails,
      durationMs: healthResults.durationMs,
      triggeredBy: healthResults.triggeredBy,
      timestamp: healthResults.timestamp,
    })
    .from(healthResults)
    .innerJoin(healthTestDef, eq(healthTestDef.id, healthResults.healthTestDefId))
    .where(eq(healthResults.sessionUuid, latest.sessionUuid));

  if (rows.length === 0) return null;

  const runs: HealthProbeRun[] = rows.map((r) => ({
    name: r.name,
    displayName: r.displayName,
    groupId: PROBE_GROUP_BY_NAME[r.name] ?? "other",
    severity: r.severity,
    isBillingRisk: r.isBillingRisk,
    result: r.result,
    details: r.details ?? "",
    durationMs: r.durationMs ?? 0,
  }));

  return {
    sessionUuid: latest.sessionUuid,
    timestamp: (latest.timestamp ?? new Date()).toISOString(),
    triggeredBy: (rows[0].triggeredBy as HealthTrigger) ?? "api",
    overall: rollUp(runs.map((r) => r.result)),
    counts: {
      success: runs.filter((r) => r.result === "SUCCESS").length,
      degraded: runs.filter((r) => r.result === "DEGRADED").length,
      failure: runs.filter((r) => r.result === "FAILURE").length,
    },
    totalDurationMs: runs.reduce((m, r) => Math.max(m, r.durationMs), 0),
    runs,
  };
}

/** Recent sessions, newest first — the history strip on the dashboard. */
export async function listHealthSessions(env: Env, limit = 20) {
  const db = drizzle(env.DB);
  const rows = await db
    .select({
      sessionUuid: healthResults.sessionUuid,
      timestamp: sql<number>`max(${healthResults.timestamp})`,
      triggeredBy: sql<string>`max(${healthResults.triggeredBy})`,
      total: sql<number>`count(*)`,
      failures: sql<number>`sum(case when ${healthResults.healthTestResult} = 'FAILURE' then 1 else 0 end)`,
      degraded: sql<number>`sum(case when ${healthResults.healthTestResult} = 'DEGRADED' then 1 else 0 end)`,
    })
    .from(healthResults)
    .groupBy(healthResults.sessionUuid)
    .orderBy(desc(sql`max(${healthResults.timestamp})`))
    .limit(limit);

  return rows.map((r) => ({
    sessionUuid: r.sessionUuid,
    timestamp: new Date(r.timestamp * 1000).toISOString(),
    triggeredBy: r.triggeredBy,
    total: r.total,
    failures: r.failures,
    degraded: r.degraded,
    overall: r.failures > 0 ? "FAILURE" : r.degraded > 0 ? "DEGRADED" : "SUCCESS",
  }));
}
