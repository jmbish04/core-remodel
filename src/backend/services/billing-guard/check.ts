/**
 * @fileoverview Durable Object billing guard.
 *
 * Background: on 2026-07-19 the RemodelOrchestrator DO's `cf_agents_schedules`
 * table ran away to ~1M rows. Every alarm full-scanned it, billing ~3 BILLION
 * Durable Object row reads PER HOUR (~67B/day, ~$50/day) and racking up a
 * >$700 bill before it was caught on the invoice. The code path is fixed
 * (RemodelOrchestrator.ensureAuditSchedule), but nothing in the running system
 * would surface a recurrence — on this DO or any future one — until the next
 * bill. This guard closes that gap.
 *
 * Every run it asks the Cloudflare GraphQL Analytics API for per-namespace
 * Durable Object rows-read over the last 24h. Any namespace over the alert
 * threshold is:
 *   1. recorded as a `down` health_checks row (the frontend alert surface via
 *      GET /api/health and /api/health/billing), and
 *   2. auto-remediated if it maps to a DO class we own that exposes a
 *      `scheduleGuard()` RPC — the guard wakes exactly that instance and purges
 *      its runaway schedule table.
 *
 * Best-effort and never throws: a missing token / API error is itself recorded
 * as a `degraded` health row so the guard's own blindness is visible.
 */

import { healthChecks } from "@backend/db";
import { drizzle } from "drizzle-orm/d1";

import { getCloudflareAccountId } from "../../utils/secrets";

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const REST_BASE = "https://api.cloudflare.com/client/v4";

/** health_checks.service_name for the guard's own status + per-namespace rows. */
const GUARD_SERVICE = "durable-object-billing";

/**
 * Alert above this many rows read in 24h for a single namespace. Healthy
 * namespaces here read thousands/day; the runaway did ~67 BILLION/day. 1B/day
 * is ~1000x normal yet still only ~$1 of reads — it fires long before the spend
 * is real, and well under any legitimate workload.
 */
const ROWS_READ_24H_ALERT = 1_000_000_000;

/** Purge a DO's schedule table once it exceeds this many rows. */
const SCHEDULE_ROW_LIMIT = 10_000;

/**
 * DO classes we own that expose a `scheduleGuard(maxRows)` RPC, mapped to the
 * binding + the canonical instance name they are created with. Extend this as
 * more Agent DOs gain the hook. A namespace not listed here is alert-only.
 */
const REMEDIABLE: Record<
  string,
  { binding: keyof Env; instanceName: string }
> = {
  RemodelOrchestrator: {
    binding: "REMODEL_ORCHESTRATOR",
    instanceName: "main-house-project",
  },
};

interface NamespaceUsage {
  namespaceId: string;
  rowsRead: number;
  rowsWritten: number;
}

export interface BillingGuardResult {
  ok: boolean;
  reason?: string;
  checkedNamespaces: number;
  offenders: Array<{
    namespaceId: string;
    name: string;
    className: string;
    rowsRead: number;
    remediated: boolean;
    remediationDetail?: string;
  }>;
}

async function getGuardToken(env: Env): Promise<string | null> {
  // Same token the AI Gateway analytics uses: needs Account Analytics:Read and
  // (for namespace name resolution) Workers Scripts:Read.
  try {
    const token = await env.CLOUDFLARE_WRANGLER_API_TOKEN.get();
    return token || null;
  } catch {
    return null;
  }
}

async function graphql(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as {
    data?: any;
    errors?: Array<{ message: string }>;
  };
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  return body.data;
}

const USAGE_QUERY = `query($acct: String!, $start: Date!, $end: Date!) {
  viewer { accounts(filter: { accountTag: $acct }) {
    durableObjectsPeriodicGroups(
      limit: 5000
      filter: { date_geq: $start, date_leq: $end }
      orderBy: [date_ASC]
    ) {
      dimensions { namespaceId }
      sum { rowsRead rowsWritten }
    }
  } }
}`;

/** Sum per-namespace rows over the trailing ~24h (today + yesterday UTC). */
async function fetchUsage(
  token: string,
  accountTag: string,
): Promise<NamespaceUsage[]> {
  const now = new Date();
  const end = now.toISOString().slice(0, 10);
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const data = await graphql(token, USAGE_QUERY, {
    acct: accountTag,
    start,
    end,
  });
  const groups: Array<{
    dimensions: { namespaceId: string };
    sum: { rowsRead: number; rowsWritten: number };
  }> = data?.viewer?.accounts?.[0]?.durableObjectsPeriodicGroups ?? [];

  const byNs = new Map<string, NamespaceUsage>();
  for (const g of groups) {
    const id = g.dimensions.namespaceId;
    const acc = byNs.get(id) ?? {
      namespaceId: id,
      rowsRead: 0,
      rowsWritten: 0,
    };
    acc.rowsRead += g.sum.rowsRead;
    acc.rowsWritten += g.sum.rowsWritten;
    byNs.set(id, acc);
  }
  return [...byNs.values()];
}

/** namespaceId -> { name, className } for THIS worker's DO namespaces. */
async function resolveNamespaceNames(
  token: string,
  accountTag: string,
  wantedIds: Set<string>,
): Promise<Map<string, { name: string; className: string }>> {
  const out = new Map<string, { name: string; className: string }>();
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `${REST_BASE}/accounts/${accountTag}/workers/durable_objects/namespaces?per_page=200&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) break;
    const body = (await res.json()) as {
      result?: Array<{ id: string; name?: string; class: string }>;
    };
    const results = body.result ?? [];
    for (const ns of results) {
      if (wantedIds.has(ns.id)) {
        out.set(ns.id, { name: ns.name ?? ns.id, className: ns.class });
      }
    }
    if (results.length < 200) break;
  }
  return out;
}

async function record(
  env: Env,
  status: "healthy" | "degraded" | "down",
  serviceName: string,
  errorMessage: string | null,
): Promise<void> {
  try {
    const db = drizzle(env.DB);
    await db.insert(healthChecks).values({
      serviceName,
      status,
      errorMessage,
      timestamp: new Date(),
    });
  } catch (err) {
    console.error("[billing-guard] failed to record health row:", err);
  }
}

/**
 * Run one billing-guard pass. Safe to call from a cron; never throws.
 */
export async function checkDurableObjectBilling(
  env: Env,
): Promise<BillingGuardResult> {
  const [accountTag, token] = await Promise.all([
    getCloudflareAccountId(env),
    getGuardToken(env),
  ]);

  if (!accountTag || !token) {
    const reason = !accountTag
      ? "CLOUDFLARE_ACCOUNT_ID is not configured"
      : "No Cloudflare API token available (CLOUDFLARE_WRANGLER_API_TOKEN)";
    await record(env, "degraded", GUARD_SERVICE, `guard blind: ${reason}`);
    return { ok: false, reason, checkedNamespaces: 0, offenders: [] };
  }

  let usage: NamespaceUsage[];
  try {
    usage = await fetchUsage(token, accountTag);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await record(env, "degraded", GUARD_SERVICE, `guard query failed: ${reason}`);
    return { ok: false, reason, checkedNamespaces: 0, offenders: [] };
  }

  const overLimit = usage.filter((u) => u.rowsRead >= ROWS_READ_24H_ALERT);

  if (overLimit.length === 0) {
    await record(env, "healthy", GUARD_SERVICE, null);
    return { ok: true, checkedNamespaces: usage.length, offenders: [] };
  }

  // Only resolve names when there is actually something to alert on.
  const names = await resolveNamespaceNames(
    token,
    accountTag,
    new Set(overLimit.map((u) => u.namespaceId)),
  ).catch(() => new Map<string, { name: string; className: string }>());

  const offenders: BillingGuardResult["offenders"] = [];

  for (const u of overLimit) {
    const meta = names.get(u.namespaceId);
    const className = meta?.className ?? "unknown";
    const name = meta?.name ?? u.namespaceId;

    let remediated = false;
    let remediationDetail: string | undefined;

    const target = REMEDIABLE[className];
    if (target) {
      try {
        const binding = env[target.binding] as unknown as {
          getByName: (n: string) => {
            scheduleGuard: (max: number) => Promise<{
              rows: number;
              purged: number;
            }>;
          };
        };
        const stub = binding.getByName(target.instanceName);
        const r = await stub.scheduleGuard(SCHEDULE_ROW_LIMIT);
        remediated = r.purged > 0;
        remediationDetail = `scheduleGuard: rows=${r.rows} purged=${r.purged}`;
      } catch (err) {
        remediationDetail = `remediation failed: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    } else {
      remediationDetail = "no automated remediation for this class — manual review";
    }

    const detail =
      `Durable Object "${name}" (${className}) read ${(
        u.rowsRead / 1e9
      ).toFixed(2)}B rows in 24h ` +
      `(alert ≥ ${(ROWS_READ_24H_ALERT / 1e9).toFixed(2)}B). ${remediationDetail}`;
    console.error(`[billing-guard] ALERT: ${detail}`);
    await record(env, "down", `${GUARD_SERVICE}:${className}`, detail);

    offenders.push({
      namespaceId: u.namespaceId,
      name,
      className,
      rowsRead: u.rowsRead,
      remediated,
      remediationDetail,
    });
  }

  // Roll the offender state up to the guard's own service row so /api/health
  // flips to "down" the moment any DO is over budget.
  await record(
    env,
    "down",
    GUARD_SERVICE,
    `${offenders.length} Durable Object namespace(s) over the row-read budget`,
  );

  return { ok: false, checkedNamespaces: usage.length, offenders };
}
