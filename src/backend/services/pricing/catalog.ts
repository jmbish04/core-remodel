/**
 * @fileoverview The price catalog — weekly refresh, and the lookup that prices
 * a call.
 *
 * Two responsibilities, deliberately in one file because they share the model-id
 * matching rule and a drift between them would silently mis-price everything:
 *
 *   refreshPricingCatalog()  — the weekly write path (cron)
 *   priceOf() / estimateCostUsd() — the per-call read path (recordUsage)
 */
import { modelPricing, pricingFetchRuns } from "@backend/db";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";

import { startRun } from "@backend/services/agent-runs";

import {
  fetchAnthropicPricing,
  fetchGeminiPricing,
  fetchOpenAiPricing,
  fetchWorkersAiPricing,
  normalizeModelId,
  type PriceRow,
} from "./fetchers";

export interface ProviderRefreshResult {
  provider: string;
  status: "ok" | "error";
  modelsFound: number;
  modelsChanged: number;
  error?: string;
  durationMs: number;
}

/** How stale a catalog may get before the UI flags it. One weekly miss + slack. */
export const STALE_AFTER_DAYS = 8;

/**
 * Refresh every provider's prices.
 *
 * Providers are refreshed INDEPENDENTLY and a failure is contained: the failing
 * provider's existing rows are left exactly as they were. Wiping a catalog
 * because a doc page 403'd would zero every cost number downstream, which is a
 * far worse outcome than a week-old price. Stale beats absent.
 */
export async function refreshPricingCatalog(env: Env): Promise<ProviderRefreshResult[]> {
  const db = drizzle(env.DB);

  const run = await startRun(env, {
    agent: "pricing-catalog",
    operation: "refresh_pricing",
    triggeredBy: "cron",
  });

  const sources: Array<[string, () => Promise<PriceRow[]>]> = [
    ["ANTHROPIC", fetchAnthropicPricing],
    ["GEMINI", fetchGeminiPricing],
    ["OPENAI", fetchOpenAiPricing],
    ["WORKERS_AI", () => fetchWorkersAiPricing(env)],
  ];

  const results: ProviderRefreshResult[] = [];

  for (const [provider, fetcher] of sources) {
    const started = Date.now();
    try {
      const rows = await run.step(`fetch ${provider}`, () => fetcher());
      const changed = await upsertRows(db, rows);
      const result: ProviderRefreshResult = {
        provider,
        status: "ok",
        modelsFound: rows.length,
        modelsChanged: changed,
        durationMs: Date.now() - started,
      };
      results.push(result);
      await logFetchRun(db, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // Contained: no rows are touched for this provider, so yesterday's prices
      // survive. The failure is recorded in two places — here for the pricing
      // page, and on the run's step for /admin/system/agents/failed.
      const result: ProviderRefreshResult = {
        provider,
        status: "error",
        modelsFound: 0,
        modelsChanged: 0,
        error: message,
        durationMs: Date.now() - started,
      };
      results.push(result);
      await logFetchRun(db, result);
      console.error(`[pricing] ${provider} refresh failed:`, message);
    }
  }

  const failed = results.filter((r) => r.status === "error");
  const digest = {
    providers: results.length,
    ok: results.length - failed.length,
    failed: failed.map((f) => f.provider),
    models: results.reduce((n, r) => n + r.modelsFound, 0),
    changed: results.reduce((n, r) => n + r.modelsChanged, 0),
  };

  // Every provider failing is a real outage of this feature, not a partial
  // success — surface it as a failed run rather than a green one with a caveat.
  if (failed.length === results.length) {
    await run.fail(new Error(`all ${results.length} pricing providers failed`));
  } else {
    await run.succeed(digest);
  }

  return results;
}

/** Upsert one provider's rows; returns how many actually changed price. */
async function upsertRows(db: ReturnType<typeof drizzle>, rows: PriceRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const provider = rows[0].provider;
  const existing = await db
    .select({
      model: modelPricing.model,
      input: modelPricing.inputPerMillionUsd,
      output: modelPricing.outputPerMillionUsd,
    })
    .from(modelPricing)
    .where(eq(modelPricing.provider, provider));

  const before = new Map(existing.map((e) => [e.model, e]));
  let changed = 0;
  const now = new Date();

  const stmts = rows.map((r) => {
    const prev = before.get(r.model);
    if (!prev || prev.input !== r.inputPerMillionUsd || prev.output !== r.outputPerMillionUsd) {
      changed += 1;
    }
    return db
      .insert(modelPricing)
      .values({
        provider: r.provider,
        model: r.model,
        displayName: r.displayName ?? null,
        inputPerMillionUsd: r.inputPerMillionUsd,
        outputPerMillionUsd: r.outputPerMillionUsd,
        cachedInputPerMillionUsd: r.cachedInputPerMillionUsd ?? null,
        unit: r.unit ?? "tokens",
        sourceUrl: r.sourceUrl,
        sourceNote: r.sourceNote ?? null,
        isActive: true,
        fetchedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [modelPricing.provider, modelPricing.model],
        set: {
          displayName: r.displayName ?? null,
          inputPerMillionUsd: r.inputPerMillionUsd,
          outputPerMillionUsd: r.outputPerMillionUsd,
          cachedInputPerMillionUsd: r.cachedInputPerMillionUsd ?? null,
          unit: r.unit ?? "tokens",
          sourceUrl: r.sourceUrl,
          sourceNote: r.sourceNote ?? null,
          isActive: true,
          fetchedAt: now,
          updatedAt: now,
        },
      });
  });

  // db.batch(), never db.transaction() — D1 rejects BEGIN outright (error 7500)
  // and the callback never executes. Chunked because D1 caps bound parameters.
  for (let i = 0; i < stmts.length; i += 20) {
    const chunk = stmts.slice(i, i + 20);
    await db.batch(chunk as [(typeof chunk)[number], ...(typeof chunk)[number][]]);
  }

  // Retire rows this SUCCESSFUL refresh did not see. Soft-delete, not delete:
  // a withdrawn model keeps its row so historic cost stays explainable, it just
  // stops being offered for new pricing. Only reached on success, so a failed
  // fetch can never retire a provider's whole catalog.
  const fresh = new Set(rows.map((r) => r.model));
  const stale = existing.map((e) => e.model).filter((m) => !fresh.has(m));
  if (stale.length > 0) {
    for (let i = 0; i < stale.length; i += 20) {
      const chunk = stale.slice(i, i + 20).map((model) =>
        db
          .update(modelPricing)
          .set({ isActive: false, updatedAt: now })
          .where(and(eq(modelPricing.provider, provider), eq(modelPricing.model, model))),
      );
      await db.batch(chunk as [(typeof chunk)[number], ...(typeof chunk)[number][]]);
    }
  }

  return changed;
}

async function logFetchRun(db: ReturnType<typeof drizzle>, r: ProviderRefreshResult): Promise<void> {
  try {
    await db.insert(pricingFetchRuns).values({
      provider: r.provider,
      status: r.status,
      modelsFound: r.modelsFound,
      modelsChanged: r.modelsChanged,
      errorMessage: r.error ?? null,
      durationMs: r.durationMs,
    });
  } catch (err) {
    console.error("[pricing] failed to log fetch run:", err);
  }
}

// ── Read path ────────────────────────────────────────────────────────────────

export interface PriceMatch {
  inputPerMillionUsd: number | null;
  outputPerMillionUsd: number | null;
  unit: string;
  /** Which rule matched — recorded so a surprising price is traceable. */
  matchedBy: "exact" | "prefix";
  matchedModel: string;
}

/**
 * In-isolate memo. The catalog changes weekly; an isolate lives minutes. Reading
 * D1 on every single AI call to fetch a number that cannot have changed would
 * make the metering more expensive than some of the calls it measures.
 */
let cache: { at: number; rows: Map<string, PriceMatch[]> } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadCatalog(env: Env): Promise<Map<string, PriceMatch[]>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;

  const db = drizzle(env.DB);
  const rows = await db
    .select({
      provider: modelPricing.provider,
      model: modelPricing.model,
      input: modelPricing.inputPerMillionUsd,
      output: modelPricing.outputPerMillionUsd,
      unit: modelPricing.unit,
    })
    .from(modelPricing)
    .where(eq(modelPricing.isActive, true));

  const byProvider = new Map<string, PriceMatch[]>();
  for (const r of rows) {
    const list = byProvider.get(r.provider) ?? [];
    list.push({
      inputPerMillionUsd: r.input,
      outputPerMillionUsd: r.output,
      unit: r.unit,
      matchedBy: "exact",
      matchedModel: r.model,
    });
    byProvider.set(r.provider, list);
  }

  // Longest model id first, so prefix matching picks the most specific entry
  // rather than whichever happened to be inserted first.
  for (const list of byProvider.values()) {
    list.sort((a, b) => b.matchedModel.length - a.matchedModel.length);
  }

  cache = { at: Date.now(), rows: byProvider };
  return byProvider;
}

/** Drop the memo — used after a refresh so new prices apply immediately. */
export function invalidatePricingCache(): void {
  cache = null;
}

/**
 * Find the price for a (provider, model).
 *
 * Exact id first, then longest-prefix — vendors ship dated variants
 * (`gemini-2.5-flash-preview-09-2025`) that should price off their base model
 * rather than silently missing the catalog entirely.
 *
 * Returns null on a miss. The caller must store NULL, not 0.
 */
export async function priceOf(
  env: Env,
  provider: string,
  model: string,
): Promise<PriceMatch | null> {
  const catalog = await loadCatalog(env);
  const list = catalog.get(provider);
  if (!list?.length) return null;

  const id = normalizeModelId(model);
  const exact = list.find((p) => p.matchedModel === id);
  if (exact) return { ...exact, matchedBy: "exact" };

  const prefix = list.find((p) => id.startsWith(p.matchedModel) || p.matchedModel.startsWith(id));
  return prefix ? { ...prefix, matchedBy: "prefix" } : null;
}

export interface CostEstimate {
  costUsd: number | null;
  note: string;
}

/**
 * Cost for one call, input and output priced SEPARATELY.
 *
 * Output tokens cost 3-5x input at every major vendor, so a blended rate is not
 * an approximation — it is a wrong answer that is wrong by a different amount
 * for every workload.
 *
 * A catalog miss yields `costUsd: null` and a note saying so. Never 0: "we do
 * not know what this cost" and "this was free" have to stay distinguishable, or
 * the reconciliation on the usage page is meaningless.
 */
export async function estimateCostUsd(
  env: Env,
  provider: string,
  model: string,
  promptTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): Promise<CostEstimate> {
  const price = await priceOf(env, provider, model).catch(() => null);
  if (!price) return { costUsd: null, note: `no catalog entry for ${provider}/${model}` };

  if (price.unit !== "tokens") {
    // A per-image or per-second model priced by token count would be nonsense.
    return { costUsd: null, note: `model priced per ${price.unit}, not tokens` };
  }

  const inTok = promptTokens ?? 0;
  const outTok = outputTokens ?? 0;
  if (inTok === 0 && outTok === 0) {
    return { costUsd: null, note: "no token counts reported by the provider" };
  }

  const inCost = price.inputPerMillionUsd !== null ? (inTok / 1_000_000) * price.inputPerMillionUsd : 0;
  const outCost =
    price.outputPerMillionUsd !== null ? (outTok / 1_000_000) * price.outputPerMillionUsd : 0;

  if (price.inputPerMillionUsd === null && price.outputPerMillionUsd === null) {
    return { costUsd: null, note: `catalog entry ${price.matchedModel} has no rates` };
  }

  return {
    costUsd: inCost + outCost,
    note: `${price.matchedBy} match on ${price.matchedModel} · in ${price.inputPerMillionUsd ?? "?"}/M · out ${price.outputPerMillionUsd ?? "?"}/M`,
  };
}
