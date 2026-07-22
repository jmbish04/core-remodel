/**
 * @fileoverview Usage metering + circuit breaker for every metered provider.
 *
 * WHY THIS EXISTS. Only Google Places was metered, and its ceiling was hardcoded
 * (`MAX_CALLS_PER_MONTH = 8000`, calendar month, in `services/google/maps.ts`).
 * Workers AI, Gemini, Browser Rendering, Durable Objects, Vectorize and CF
 * Images were unmetered — and deep research is expensive enough that "no brake"
 * is a real financial risk, not a theoretical one.
 *
 * TWO DELIBERATE DECISIONS, both about NOT duplicating what exists:
 *
 *  1. **Usage rows go in `gemini_usage_log`, not a new table.** It already
 *     carries model / feature / prompt+output tokens / total / cost / status /
 *     request_meta — precisely the shape every provider needs. It gained a
 *     `provider` column instead of gaining a sibling table per provider.
 *
 *  2. **Thresholds go in `project_system_variables`, not a new table.** It is
 *     already the key/value config store (`variable_key`, `value_text`,
 *     `category`), and a threshold is config.
 *
 * THE BREAKER FAILS CLOSED. `canSpend()` denies when it cannot read spend. The
 * existing Places breaker fails OPEN ("fail-open strategy if D1 schema isn't
 * migrated yet"), which defeats the entire point of a spend ceiling: the moment
 * the ledger is unreadable is exactly when an uncapped loop does the damage.
 */

import { drizzle } from "drizzle-orm/d1";
import { currentAgentRunId } from "../agent-run-context";
import { and, eq, gte, sql } from "drizzle-orm";

import { geminiUsage } from "@backend/db/schema/system/gemini-usage";
import { projectSystemVariables } from "@backend/db/schema/home/project_system_variables";
import { decideSpend, cycleStart } from "./breaker-rules";

export { decideSpend, cycleStart } from "./breaker-rules";
export type { BreakerDecision, BreakerReason } from "./breaker-rules";

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export const METERED_PROVIDERS = [
  "GEMINI",
  "WORKERS_AI",
  "BROWSER_RENDERING",
  "DURABLE_OBJECT",
  "VECTORIZE",
  "CF_IMAGES",
  "GOOGLE_PLACES",
] as const;

export type MeteredProvider = (typeof METERED_PROVIDERS)[number];

/** Config namespace inside `project_system_variables.category`. */
const CONFIG_CATEGORY = "usage_metering";

/**
 * Per-provider config keys. Kept as one flat key space (`usage.<PROVIDER>.<k>`)
 * so the whole config reads in a single query rather than one per provider.
 */
function key(provider: MeteredProvider, field: string): string {
  return `usage.${provider}.${field}`;
}

/** Global keys (not provider-scoped). */
const CYCLE_ANCHOR_DAY_KEY = "usage.cycle_anchor_day";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  provider: MeteredProvider;
  /** Hard ceiling in USD for the current cycle. 0 = unlimited (not recommended). */
  thresholdUsd: number;
  /** Manual break-glass: true = deny regardless of spend. */
  manualBreak: boolean;
  /**
   * A raised ceiling that supersedes `thresholdUsd` until spend reaches it,
   * then the breaker trips again at the new number. Null = not snoozed.
   */
  snoozeToUsd: number | null;
}

/** Day of month the billing cycle starts on (1-28). */
export interface MeteringConfig {
  cycleAnchorDay: number;
  providers: Record<MeteredProvider, ProviderConfig>;
}

const DEFAULT_THRESHOLD_USD = 25;
const DEFAULT_ANCHOR_DAY = 1;

type Db = ReturnType<typeof drizzle>;

function num(raw: string | null | undefined, fallback: number): number {
  const n = Number.parseFloat(String(raw ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Read the whole metering config in one query.
 *
 * Missing rows fall back to defaults rather than throwing — an unconfigured
 * provider is still metered, just at the default ceiling.
 */
export async function getMeteringConfig(env: Env): Promise<MeteringConfig> {
  const db = drizzle(env.DB);
  const rows = await db
    .select({
      variableKey: projectSystemVariables.variableKey,
      valueText: projectSystemVariables.valueText,
    })
    .from(projectSystemVariables)
    .where(eq(projectSystemVariables.category, CONFIG_CATEGORY));

  const byKey = new Map(rows.map((r) => [r.variableKey, r.valueText]));

  const providers = {} as Record<MeteredProvider, ProviderConfig>;
  for (const provider of METERED_PROVIDERS) {
    const snoozeRaw = byKey.get(key(provider, "snooze_to_usd"));
    providers[provider] = {
      provider,
      thresholdUsd: num(byKey.get(key(provider, "threshold_usd")), DEFAULT_THRESHOLD_USD),
      manualBreak: byKey.get(key(provider, "manual_break")) === "true",
      snoozeToUsd:
        snoozeRaw === undefined || snoozeRaw === null || snoozeRaw === ""
          ? null
          : num(snoozeRaw, 0),
    };
  }

  return {
    cycleAnchorDay: Math.min(
      Math.max(Math.trunc(num(byKey.get(CYCLE_ANCHOR_DAY_KEY), DEFAULT_ANCHOR_DAY)), 1),
      28,
    ),
    providers,
  };
}

/** Upsert one config value. */
export async function setConfigValue(
  env: Env,
  variableKey: string,
  valueText: string,
): Promise<void> {
  const db = drizzle(env.DB);
  // Single atomic upsert. A select-then-insert races: two concurrent writers
  // for the same new key both miss, both insert, and the second trips the
  // unique constraint on `variable_key`.
  await db
    .insert(projectSystemVariables)
    .values({
      variableKey,
      valueText,
      category: CONFIG_CATEGORY,
      // notNull + unique on this table; mirror the key so it stays stable.
      mappingRefKey: variableKey,
      description: "Usage metering / circuit breaker configuration.",
    })
    .onConflictDoUpdate({
      target: projectSystemVariables.variableKey,
      set: { valueText },
    });
}

// ---------------------------------------------------------------------------
// Billing cycle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

export interface UsageRecord {
  /**
   * The `agent_runs.id` this call belongs to. Defaults to the ambient run
   * context, so an AI call inside `run.step(...)` attributes itself with no
   * change at the call site (~130 `env.AI.run` sites stay untouched).
   */
  agentRunId?: number | null;
  provider: MeteredProvider;
  model: string;
  feature?: string;
  promptTokens?: number | null;
  outputTokens?: number | null;
  thoughtsTokens?: number | null;
  cachedTokens?: number | null;
  totalTokens?: number | null;
  costUsd?: number | null;
  status?: "ok" | "error";
  errorMessage?: string | null;
  meta?: Record<string, unknown> | null;
}

/**
 * Append one usage row. NEVER throws — a metering failure must not take down
 * the call it is measuring. Failures are logged, loudly.
 */
export async function recordUsage(env: Env, rec: UsageRecord): Promise<void> {
  try {
    const db = drizzle(env.DB);
    await db.insert(geminiUsage).values({
      agentRunId: rec.agentRunId ?? currentAgentRunId(),
      provider: rec.provider,
      model: rec.model,
      feature: rec.feature ?? "unknown",
      status: rec.status ?? "ok",
      promptTokens: rec.promptTokens ?? null,
      candidatesTokens: rec.outputTokens ?? null,
      thoughtsTokens: rec.thoughtsTokens ?? null,
      cachedTokens: rec.cachedTokens ?? null,
      // Derive a total when the provider did not report one; keep null rather
      // than storing a misleading 0 when neither side is known.
      totalTokens:
        rec.totalTokens ??
        ((rec.promptTokens ?? 0) + (rec.outputTokens ?? 0) || null),
      estimatedCostUsd: rec.costUsd ?? null,
      errorMessage: rec.errorMessage ?? null,
      requestMeta: rec.meta ?? null,
    });
  } catch (err) {
    console.error(`[metering] FAILED to record ${rec.provider}/${rec.model} usage:`, err);
  }
}

// ---------------------------------------------------------------------------
// Spend + breaker
// ---------------------------------------------------------------------------

/** Total estimated USD spend for a provider in the current cycle. */
export async function getCycleSpend(
  env: Env,
  provider: MeteredProvider,
  config?: MeteringConfig,
): Promise<number> {
  const cfg = config ?? (await getMeteringConfig(env));
  const db: Db = drizzle(env.DB);
  const start = cycleStart(cfg.cycleAnchorDay);

  const row = await db
    .select({ total: sql<number>`COALESCE(SUM(${geminiUsage.estimatedCostUsd}), 0)` })
    .from(geminiUsage)
    .where(
      and(
        eq(geminiUsage.provider, provider),
        // `timestamp` is mode:"timestamp", so drizzle serializes the Date to
        // seconds itself — a manual /1000 duplicates that and drifts if the
        // column mode ever changes.
        gte(geminiUsage.timestamp, start),
      ),
    )
    .get();

  return row?.total ?? 0;
}

export interface SpendDecision {
  allowed: boolean;
  provider: MeteredProvider;
  spendUsd: number;
  ceilingUsd: number;
  reason: "ok" | "manual_break" | "over_threshold" | "read_error";
}

/**
 * May this provider spend right now?
 *
 * FAILS CLOSED. If spend cannot be read, the answer is NO — the moment the
 * ledger is unreadable is exactly when an uncapped loop does the damage. This
 * is the deliberate opposite of the legacy Places breaker's fail-open.
 */
export async function canSpend(
  env: Env,
  provider: MeteredProvider,
): Promise<SpendDecision> {
  let cfg: MeteringConfig;
  let spend: number;
  try {
    cfg = await getMeteringConfig(env);
    spend = await getCycleSpend(env, provider, cfg);
  } catch (err) {
    console.error(`[metering] cannot read spend for ${provider} — DENYING:`, err);
    return {
      allowed: false,
      provider,
      spendUsd: 0,
      ceilingUsd: 0,
      reason: "read_error",
    };
  }

  const pc = cfg.providers[provider];
  const decision = decideSpend({
    manualBreak: pc.manualBreak,
    snoozeToUsd: pc.snoozeToUsd,
    thresholdUsd: pc.thresholdUsd,
    spendUsd: spend,
  });

  return { ...decision, provider, spendUsd: spend };
}

/** Trip the manual break for a provider. */
export async function tripBreaker(env: Env, provider: MeteredProvider): Promise<void> {
  await setConfigValue(env, key(provider, "manual_break"), "true");
}

/** Clear the manual break. */
export async function resetBreaker(env: Env, provider: MeteredProvider): Promise<void> {
  await setConfigValue(env, key(provider, "manual_break"), "false");
  await setConfigValue(env, key(provider, "snooze_to_usd"), "");
}

/**
 * Raise the ceiling by `amountUsd` above CURRENT SPEND, and clear any manual
 * break. The breaker trips again when spend reaches the new number.
 *
 * Anchored to current spend rather than to the threshold so "snooze $10" always
 * buys exactly $10 more, regardless of how far over the original ceiling the
 * account already is.
 */
export async function snooze(
  env: Env,
  provider: MeteredProvider,
  amountUsd: number,
): Promise<number> {
  const spend = await getCycleSpend(env, provider);
  const newCeiling = Math.max(0, spend + Math.max(0, amountUsd));
  await setConfigValue(env, key(provider, "snooze_to_usd"), String(newCeiling));
  await setConfigValue(env, key(provider, "manual_break"), "false");
  return newCeiling;
}

/** Config key helpers, exported so the config route writes the same keys. */
export const usageConfigKeys = {
  threshold: (p: MeteredProvider) => key(p, "threshold_usd"),
  manualBreak: (p: MeteredProvider) => key(p, "manual_break"),
  snooze: (p: MeteredProvider) => key(p, "snooze_to_usd"),
  cycleAnchorDay: CYCLE_ANCHOR_DAY_KEY,
};
