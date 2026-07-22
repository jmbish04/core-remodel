/**
 * @fileoverview Per-provider health, latency and uptime, computed from the
 * usage ledger.
 *
 * Everything here is DERIVED. Nothing polls a provider to ask if it is up —
 * a synthetic ping tells you the vendor's status page is green, not whether
 * *our* calls are working. The ledger already records every real call and its
 * outcome, so health is read off the traffic we actually sent.
 */
import { geminiUsage } from "@backend/db";
import type { UsageProvider } from "@backend/db/schema/system/gemini-usage";
import { drizzle } from "drizzle-orm/d1";
import { and, desc, eq, gte, sql } from "drizzle-orm";

import {
  PROVIDERS,
  healthFrom,
  providerDef,
  type ProviderGroup,
  type ProviderHealth,
} from "./provider-registry";

export interface ProviderHealthRow {
  provider: string;
  label: string;
  short: string;
  group: ProviderGroup;
  unit: string;
  priced: boolean;

  health: ProviderHealth;
  calls: number;
  errors: number;
  /** MEDIAN, not mean — see the note in `medianLatency`. */
  latencyMsP50: number | null;
  /** Seconds since the most recent error, or since the first call if none. */
  uptimeSeconds: number | null;
  /** True when the provider has never errored in the window. */
  cleanWindow: boolean;
  lastCallAt: Date | null;
  lastErrorAt: Date | null;
  costUsd: number;
  tokens: number;
}

/**
 * Median latency.
 *
 * Deliberately the median and not the mean: one 30-second timeout among 500
 * fast calls moves a mean by ~60ms and moves the median by nothing, and the
 * question this column answers is "how slow is a normal call", not "what was
 * the worst thing that happened". The worst thing belongs in the failure sheet.
 */
function medianLatency(values: number[]): number | null {
  const nums = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return null;
  nums.sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 0 ? Math.round((nums[mid - 1] + nums[mid]) / 2) : nums[mid];
}

/**
 * Health for every registered provider over `windowHours`.
 *
 * Returns a row for EVERY provider in the registry, including ones with no
 * traffic — a provider silently missing from the table is indistinguishable
 * from a provider that is fine.
 */
export async function providerHealth(
  env: Env,
  windowHours = 24,
  now = new Date(),
): Promise<ProviderHealthRow[]> {
  const db = drizzle(env.DB);
  const since = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

  const agg = await db
    .select({
      provider: geminiUsage.provider,
      calls: sql<number>`COUNT(*)`,
      errors: sql<number>`SUM(CASE WHEN ${geminiUsage.status} = 'error' THEN 1 ELSE 0 END)`,
      costUsd: sql<number>`COALESCE(SUM(${geminiUsage.estimatedCostUsd}), 0)`,
      tokens: sql<number>`COALESCE(SUM(${geminiUsage.totalTokens}), 0)`,
      lastCallAt: sql<number>`MAX(${geminiUsage.timestamp})`,
    })
    .from(geminiUsage)
    .where(gte(geminiUsage.timestamp, since))
    .groupBy(geminiUsage.provider);

  const byProvider = new Map(agg.map((a) => [a.provider, a]));

  // Latency samples and last-error timestamps, per provider. Two small extra
  // reads rather than one clever query: SQLite has no percentile function, and
  // a hand-rolled median in SQL would be less readable than this.
  const rows = await Promise.all(
    PROVIDERS.map(async (def) => {
      const a = byProvider.get(def.id as UsageProvider);
      const calls = Number(a?.calls ?? 0);
      const errors = Number(a?.errors ?? 0);

      if (calls === 0) {
        const idle: ProviderHealthRow = {
          ...base(def),
          health: "OFFLINE",
          calls: 0,
          errors: 0,
          latencyMsP50: null,
          uptimeSeconds: null,
          cleanWindow: true,
          lastCallAt: null,
          lastErrorAt: null,
          costUsd: 0,
          tokens: 0,
        };
        return idle;
      }

      const [latencies, lastError, firstCall] = await Promise.all([
        db
          .select({ ms: geminiUsage.latencyMs })
          .from(geminiUsage)
          .where(and(eq(geminiUsage.provider, def.id as UsageProvider), gte(geminiUsage.timestamp, since)))
          .limit(500),
        db
          .select({ at: geminiUsage.timestamp })
          .from(geminiUsage)
          .where(and(eq(geminiUsage.provider, def.id as UsageProvider), eq(geminiUsage.status, "error")))
          .orderBy(desc(geminiUsage.timestamp))
          .limit(1),
        db
          .select({ at: geminiUsage.timestamp })
          .from(geminiUsage)
          .where(eq(geminiUsage.provider, def.id as UsageProvider))
          .orderBy(geminiUsage.timestamp)
          .limit(1),
      ]);

      const lastErrorAt = lastError[0]?.at ?? null;
      // Uptime is measured from the last error, or from the first call ever
      // when there has never been one. Reporting "unknown" for a provider with
      // a spotless record would be the wrong way round.
      const anchor = lastErrorAt ?? firstCall[0]?.at ?? null;

      const row: ProviderHealthRow = {
        ...base(def),
        health: healthFrom(calls, errors),
        calls,
        errors,
        latencyMsP50: medianLatency(latencies.map((l) => l.ms).filter((v): v is number => v !== null)),
        uptimeSeconds: anchor ? Math.max(0, Math.round((now.getTime() - anchor.getTime()) / 1000)) : null,
        cleanWindow: errors === 0,
        lastCallAt: a?.lastCallAt ? new Date(Number(a.lastCallAt) * 1000) : null,
        lastErrorAt,
        costUsd: Number(a?.costUsd ?? 0),
        tokens: Number(a?.tokens ?? 0),
      };
      return row;
    }),
  );

  // Providers the ledger has seen but the registry has not. Rendered rather
  // than dropped — an unknown provider spending money must be visible.
  for (const [id, a] of byProvider) {
    if (PROVIDERS.some((p) => p.id === id)) continue;
    const def = providerDef(id);
    rows.push({
      ...base(def),
      health: healthFrom(Number(a.calls), Number(a.errors)),
      calls: Number(a.calls),
      errors: Number(a.errors),
      latencyMsP50: null,
      uptimeSeconds: null,
      cleanWindow: Number(a.errors) === 0,
      lastCallAt: a.lastCallAt ? new Date(Number(a.lastCallAt) * 1000) : null,
      lastErrorAt: null,
      costUsd: Number(a.costUsd),
      tokens: Number(a.tokens),
    });
  }

  return rows;
}

function base(def: ReturnType<typeof providerDef>) {
  return {
    provider: def.id,
    label: def.label,
    short: def.short,
    group: def.group,
    unit: def.unit,
    priced: def.priced,
  };
}
