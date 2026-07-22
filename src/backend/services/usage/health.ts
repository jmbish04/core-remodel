/**
 * @fileoverview Health probes for the usage-metering module
 * (`src/backend/services/usage`). THIS IS THE BILLING-RISK MODULE.
 *
 * Everything here exists because of a real invoice. A `RemodelOrchestrator`
 * Durable Object doing full table scans on a schedule burned roughly $50/day
 * before anyone noticed, and Google Places was the only metered provider at the
 * time — Workers AI, Gemini, Browser Rendering, Vectorize and CF Images had no
 * brake at all. `metering.ts` added the ledger and the circuit breaker; these
 * probes are the part that TELLS SOMEONE, because a breaker that trips silently
 * at 3am and a runaway that nobody sees cost the same amount of money.
 *
 * COST DISCIPLINE. Every probe below is a small number of aggregate `SELECT`s
 * against `gemini_usage_log`, `google_maps_usage_log` and `agent_runs`. Nothing
 * invokes a model, calls a paid API, or fans out per provider — the breaker
 * probe deliberately uses ONE grouped query rather than seven per-provider ones,
 * because repeatedly scanning an append-only ledger is precisely the shape of
 * the bug that started all this.
 */

import { getMeteringConfig, METERED_PROVIDERS } from "./metering";
import { cycleStart } from "./breaker-rules";

import {
  defineProbe,
  degraded,
  failure,
  ok,
  scalar,
  tableExists,
  type HealthProbe,
  type HealthProbeOutcome,
} from "@backend/services/health/types";

const FILE = "src/backend/services/usage/health.ts";

/** Spike thresholds, shared by every "last 24h vs trailing 7-day daily average" probe. */
const DEGRADED_RATIO = 2;
const FAILURE_RATIO = 5;

interface Spike {
  recent: number;
  baselineDaily: number;
  /** null when there is no baseline to divide by. */
  ratio: number | null;
}

/**
 * Last 24h vs the daily average of the 7 days BEFORE that window.
 *
 * The baseline deliberately excludes the last 24h — including it would let a
 * spike inflate its own baseline and hide itself. Two queries rather than one
 * CASE-aggregate because `scalar()` returns a single column; both are bounded
 * aggregates over the same index-free append-only table, so the cost is the
 * same order either way.
 *
 * `table`, `tsColumn`, `valueExpr` and `where` are code literals, never user
 * input — no injection surface.
 */
async function spike(
  db: D1Database,
  table: string,
  tsColumn: string,
  valueExpr: string,
  where = "1=1",
): Promise<Spike> {
  const recent = await scalar(
    db,
    `SELECT COALESCE(${valueExpr}, 0) FROM ${table} WHERE ${where} AND ${tsColumn} >= unixepoch() - 86400`,
  );
  const priorTotal = await scalar(
    db,
    `SELECT COALESCE(${valueExpr}, 0) FROM ${table} WHERE ${where} AND ${tsColumn} < unixepoch() - 86400 AND ${tsColumn} >= unixepoch() - 86400 * 8`,
  );
  const baselineDaily = priorTotal / 7;
  return { recent, baselineDaily, ratio: baselineDaily > 0 ? recent / baselineDaily : null };
}

/** Grade a spike consistently: >5x fails, >2x degrades, no-baseline-but-active degrades. */
function gradeSpike(s: Spike, unit: string, noun: string): HealthProbeOutcome {
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  const base = `${noun}: ${fmt(s.recent)} ${unit} in the last 24h vs a trailing 7-day average of ${fmt(s.baselineDaily)} ${unit}/day`;

  if (s.ratio === null) {
    if (s.recent === 0) return ok(`${base} — both zero, nothing consumed.`);
    return degraded(
      `${base} — NO BASELINE (nothing in the prior 7 days), so this cannot be judged as normal or not. Verify manually.`,
    );
  }
  const detail = `${base} (${s.ratio.toFixed(1)}x).`;
  if (s.ratio > FAILURE_RATIO) return failure(`SPEND SPIKE — ${detail}`);
  if (s.ratio > DEGRADED_RATIO) return degraded(`Elevated — ${detail}`);
  return ok(detail);
}

/** Shared 3am guidance for every spike probe: how to find WHAT is burning money. */
const SPIKE_TRIAGE =
  "1. Find the source before doing anything else: `npx wrangler d1 execute core-remodel --remote --command \"SELECT provider, model, feature, COUNT(*) c, SUM(COALESCE(estimated_cost_usd,0)) usd FROM gemini_usage_log WHERE timestamp >= unixepoch() - 86400 GROUP BY 1,2,3 ORDER BY usd DESC LIMIT 20\"` — the `feature` column names the calling surface. 2. Compare against the same query for the prior week to see which feature is NEW rather than merely large. 3. Cross-check the independent view: Cloudflare dashboard > AI > AI Gateway > core-remodel for request volume, and AI > Workers AI for account-level neurons. 4. If a retry storm is the cause you will see many rows with `status='error'` for one model — a failing upstream that we keep hammering. 5. Stop the bleeding before diagnosing further: trip the manual breaker for the offending provider (`tripBreaker`, or set `usage.<PROVIDER>.manual_break=true` in `project_system_variables`), which denies further spend immediately.";

const SPIKE_PLAYBOOK =
  "1. STOP THE SPEND FIRST, diagnose second: trip the manual breaker for the offending provider so `canSpend()` denies every further call. 2. Identify the driver with the group-by query above; the usual suspects are a cron that started looping, a newly-adopted metered path that was previously unmetered (so the ledger jumped without spend actually changing), and a Durable Object alarm rescheduling itself. 3. Confirm which of those it is BEFORE reverting anything — a jump caused by adopting `meteredAiRun()` on a hot path is accounting catching up, not new spend, and reverting it makes you blind again. 4. Fix, PR, merge, `pnpm run deploy`. 5. Clear the breaker with `resetBreaker` (or `snooze` for a bounded raise) only once the driver is understood. 6. Re-run this probe and confirm the ratio falls back under 2x over the next 24h.";

export const HEALTH_PROBES: HealthProbe[] = [
  defineProbe({
    name: "usage_ai_spend_24h_vs_baseline",
    displayName: "AI spend: last 24h vs 7-day baseline",
    description:
      "Sums `gemini_usage_log.estimated_cost_usd` for the last 24h and compares it to the daily average of the 7 days before that window. DEGRADED above 2x, FAILURE above 5x. Pure SQL — no provider APIs are called.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Recorded AI spend over the last day is within 2x its recent daily norm. Nothing is looping, no pipeline has quietly started re-running, and the circuit breakers have not needed to intervene. Note this measures RECORDED spend — it is only as complete as `recordUsage()` adoption, which is why the logging-liveness probe exists alongside it.",
    whatFailureMeans:
      "Recorded AI spend in the last 24h is more than 5x the recent daily average. Historically this shape has meant one of: a Durable Object alarm rescheduling itself in a tight loop, a research/scrape workflow retrying without a ceiling, or a newly-adopted metering wrapper making previously-invisible spend visible. The first two are real money leaving the account right now; the third is accounting catching up. You must tell them apart before reverting anything.",
    troubleshootingSteps: SPIKE_TRIAGE,
    devOpsPlaybook: SPIKE_PLAYBOOK,
    isBillingRisk: true,
    severity: "HIGH",
    run: async (env) => {
      const db = env.DB;
      if (!(await tableExists(db, "gemini_usage_log"))) {
        return failure(
          "Table `gemini_usage_log` does not exist — unapplied migration. The spend ledger is entirely absent; run `pnpm run migrate:remote`.",
        );
      }
      const s = await spike(db, "gemini_usage_log", "timestamp", "SUM(estimated_cost_usd)");
      return gradeSpike(s, "USD", "Recorded AI spend");
    },
  }),

  defineProbe({
    name: "usage_ai_token_volume_24h_vs_baseline",
    displayName: "AI token volume: last 24h vs 7-day baseline",
    description:
      "Sums `gemini_usage_log.total_tokens` for the last 24h against the trailing 7-day daily average. Tokens catch a runaway that the cost column misses, because `estimated_cost_usd` is nullable and many providers never populate it.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Token consumption is within 2x its recent daily norm. Combined with the spend probe this is a genuine two-signal check: spend can look flat purely because nobody wrote a cost estimate, but tokens are reported by the providers themselves.",
    whatFailureMeans:
      "More than 5x the usual tokens were consumed in 24h. If this fires while the spend probe stays green, the cost column is not being populated for whatever is burning tokens — the money IS being spent, it is simply not priced in our ledger. That is the worse of the two situations, because the circuit breaker meters on dollars and will not trip on tokens alone.",
    troubleshootingSteps: `${SPIKE_TRIAGE} 6. Specifically for tokens: check whether the dominant model rows have NULL \`estimated_cost_usd\` — if so the breaker cannot see this spend at all, and the fix is to populate a cost estimate for that provider in \`metering.ts\` as well as to stop the runaway.`,
    devOpsPlaybook: `${SPIKE_PLAYBOOK} 7. If cost was NULL for the offending rows, file the follow-up to add a rate for that provider — an unpriced provider is an unbrakeable provider.`,
    isBillingRisk: true,
    severity: "HIGH",
    run: async (env) => {
      const db = env.DB;
      if (!(await tableExists(db, "gemini_usage_log"))) {
        return failure(
          "Table `gemini_usage_log` does not exist — unapplied migration. Run `pnpm run migrate:remote`.",
        );
      }
      const s = await spike(db, "gemini_usage_log", "timestamp", "SUM(total_tokens)");
      return gradeSpike(s, "tokens", "AI token volume");
    },
  }),

  defineProbe({
    name: "usage_google_maps_call_volume_spike",
    displayName: "Google Maps call volume: last 24h vs 7-day baseline",
    description:
      "Counts `google_maps_usage_log` rows in the last 24h against the trailing 7-day daily average. Google Maps Platform bills per call against a $200/month free credit, so call count IS the cost signal here.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Maps API call volume is within 2x its recent norm, so the $200 monthly free credit is being consumed at a predictable rate and no enrichment/backfill job is looping.",
    whatFailureMeans:
      "More than 5x the usual Maps calls in 24h. The usual driver is a showroom enrichment or geo-backfill sweep re-running over the whole table instead of only blank rows. Autocomplete is the expensive trap: it bills per keystroke unless a Places Details call closes the session with the same `session_token`, so a UI change that drops the token multiplies cost with no visible change in behaviour.",
    troubleshootingSteps:
      "1. Break the volume down by endpoint: `npx wrangler d1 execute core-remodel --remote --command \"SELECT endpoint, api_type, status_code, COUNT(*) c FROM google_maps_usage_log WHERE timestamp >= unixepoch() - 86400 GROUP BY 1,2,3 ORDER BY c DESC LIMIT 20\"`. 2. A dominant `autocomplete` count with few matching `details` rows means session tokens are not closing sessions — check the address-input component still threads `session_token` through to the Details call. 3. Lots of `status_code = 429` means we are already past quota and the calls are being rejected — still billable attempts in some cases, and definitely a broken feature. 4. Check whether a backfill is running: the showroom geo/media backfill tools re-run over rows that already have values if their 'blank only' filter regressed. 5. Confirm real spend against the source of truth — Google Cloud Console > Billing > Reports, filtered to Maps Platform — before concluding anything about dollars.",
    devOpsPlaybook:
      "1. Trip the GOOGLE_PLACES breaker (`usage.GOOGLE_PLACES.manual_break=true`) to stop further calls while you look. 2. Identify the endpoint from the group-by above and disable/park the job driving it. 3. Verify actual billing impact in Google Cloud Console — the free credit means a spike may cost nothing, and that determines urgency. 4. Fix the loop or the session-token threading, PR, `pnpm run deploy`. 5. Clear the breaker and re-run this probe. 6. If the table is missing entirely, run `pnpm run migrate:remote` — Maps calls are then happening completely unlogged, which is worse than the spike.",
    isBillingRisk: true,
    severity: "HIGH",
    run: async (env) => {
      const db = env.DB;
      if (!(await tableExists(db, "google_maps_usage_log"))) {
        return failure(
          "Table `google_maps_usage_log` does not exist — Maps spend is completely unlogged. Run `pnpm run migrate:remote`.",
        );
      }
      const s = await spike(db, "google_maps_usage_log", "timestamp", "COUNT(*)");
      return gradeSpike(s, "calls", "Google Maps API calls");
    },
  }),

  defineProbe({
    name: "usage_agent_run_volume_spike",
    displayName: "Agent run volume: last 24h vs 7-day baseline",
    description:
      "Counts `agent_runs` rows created in the last 24h against the trailing 7-day daily average. Agent runs are the upstream cause of most AI spend, so this fires earlier than the dollar probes.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Agents are being invoked at a normal rate. Because nearly every expensive AI call happens inside an agent run, a flat run count is decent evidence that no automation has started looping — this is the leading indicator, with spend as the lagging one.",
    whatFailureMeans:
      "More than 5x the usual agent runs in a day. Either something is scheduling agents in a loop (a cron misfiring, an alarm rescheduling itself, a retry path that creates a fresh run instead of incrementing `attempt`), or a legitimate bulk operation is underway. The `attempt`/`parent_run_id` columns tell you which: a wall of attempt=1 runs for the same target is a scheduling loop, not retries.",
    troubleshootingSteps:
      "1. Group the runs: `npx wrangler d1 execute core-remodel --remote --command \"SELECT agent, operation, triggered_by, status, COUNT(*) c FROM agent_runs WHERE created_at >= unixepoch() - 86400 GROUP BY 1,2,3,4 ORDER BY c DESC LIMIT 20\"`. 2. `triggered_by='cron'` dominating means a scheduled job is the driver — check the `triggers.crons` list in `wrangler.jsonc` and confirm nothing was duplicated by a preview deploy (previews strip crons precisely to prevent double-running against shared D1; a preview that kept them would show here). 3. Many rows with the same `target_id` and `attempt=1` is a scheduling loop; many rows with rising `attempt` and a shared `error_code` is a legitimate retry against a broken upstream — fix the upstream, not the scheduler. 4. Correlate with money: join spend by run using `gemini_usage_log.agent_run_id` to see whether the extra runs are actually costing anything. 5. Check /admin/system/agents for the same data rendered.",
    devOpsPlaybook:
      "1. Determine loop vs bulk before intervening — a legitimate backfill looks identical in aggregate. 2. If it is a loop, disable the cron or cancel the queued runs and deploy the fix; a self-rescheduling alarm keeps going through a redeploy, so also verify the Durable Object stops (see the DO runaway probe). 3. Watch the spend probes for the next 24h; agent volume returning to normal without spend following means something else is spending. 4. Missing `agent_runs` table means the instrumentation migration never landed remotely: `pnpm run migrate:remote`, then verify the table exists before trusting any agent monitoring.",
    isBillingRisk: true,
    severity: "MEDIUM",
    run: async (env) => {
      const db = env.DB;
      if (!(await tableExists(db, "agent_runs"))) {
        return failure(
          "Table `agent_runs` does not exist — the agent ledger is absent. Run `pnpm run migrate:remote`.",
        );
      }
      const s = await spike(db, "agent_runs", "created_at", "COUNT(*)");
      return gradeSpike(s, "runs", "Agent runs");
    },
  }),

  defineProbe({
    name: "usage_durable_object_runaway_watcher",
    displayName: "Durable Object invocation runaway",
    description:
      "Watches DURABLE_OBJECT-provider rows in `gemini_usage_log` and orchestrator-style agent runs for a volume jump. This probe exists because of a specific incident: a `RemodelOrchestrator` DO running full table scans on a schedule burned roughly $50/day, and nothing surfaced it until the invoice did.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1", "durable_object"],
    whatSuccessMeans:
      "Neither the DURABLE_OBJECT metering rows nor orchestrator-tagged agent runs are elevated against their 7-day baselines. The DO layer is dormant or steady, which is the expected state — this Worker's Durable Objects are event-driven, not continuously ticking.",
    whatFailureMeans:
      "A Durable Object is being invoked far more than usual. The failure mode that already cost real money is an alarm that reschedules itself combined with a query that scans an entire table on every tick: cost scales with rows × ticks, so it accelerates as the database grows and it does NOT stop when you redeploy — the alarm is durable storage, not code.",
    troubleshootingSteps:
      "1. Confirm from D1: `npx wrangler d1 execute core-remodel --remote --command \"SELECT model, feature, COUNT(*) c FROM gemini_usage_log WHERE provider='DURABLE_OBJECT' AND timestamp >= unixepoch() - 86400 GROUP BY 1,2 ORDER BY c DESC\"`. 2. Get the independent view — Cloudflare dashboard > Workers & Pages > core-remodel > Metrics, and the Durable Objects section for request/duration counts per namespace. `npx wrangler tail` shows live invocations. 3. Identify the class: the orchestrator/renovation agents are the historical offenders. Look for an `alarm()` handler that unconditionally calls `setAlarm()` again. 4. A redeploy does NOT clear a pending alarm. The DO must run once more and NOT reschedule, or the object must be reset — never assume shipping the fix stopped the bleeding; verify invocation counts actually fall. 5. There is a watcher script in the repo for this exact incident class: `scripts/do_billing_watch.py`. 6. Remember DO billing lags: the invoice reflects the runaway days after the fix, so a scary invoice is not evidence the fix failed.",
    devOpsPlaybook:
      "1. Treat as P1 — this is the incident that already happened, and it bills continuously. 2. Confirm the offending namespace in the Cloudflare dashboard Durable Objects metrics before changing code. 3. Ship the fix (stop the self-rescheduling alarm, replace any full-table scan with an indexed query), `pnpm run deploy`, then WATCH invocation counts for an hour — a pending alarm survives the deploy. 4. Do not bump the DO migration tag to force anything through; on this repo that is the guard that stops a branch from overwriting production. 5. Track the invoice for several days afterwards and expect it to lag the fix. 6. Re-run this probe daily until the ratio is back under 2x.",
    isBillingRisk: true,
    severity: "HIGH",
    run: async (env) => {
      const db = env.DB;
      const parts: string[] = [];
      let worst: HealthProbeOutcome | null = null;

      const rank = (r: HealthProbeOutcome["result"]) =>
        r === "FAILURE" ? 2 : r === "DEGRADED" ? 1 : 0;
      const consider = (o: HealthProbeOutcome) => {
        parts.push(o.details);
        if (!worst || rank(o.result) > rank(worst.result)) worst = o;
      };

      if (await tableExists(db, "gemini_usage_log")) {
        consider(
          gradeSpike(
            await spike(
              db,
              "gemini_usage_log",
              "timestamp",
              "COUNT(*)",
              "provider = 'DURABLE_OBJECT'",
            ),
            "calls",
            "Metered Durable Object invocations",
          ),
        );
      } else {
        parts.push("`gemini_usage_log` missing — DO metering rows unavailable.");
      }

      if (await tableExists(db, "agent_runs")) {
        consider(
          gradeSpike(
            await spike(
              db,
              "agent_runs",
              "created_at",
              "COUNT(*)",
              "(agent LIKE '%orchestrator%' OR agent LIKE '%renovation%')",
            ),
            "runs",
            "Orchestrator/renovation agent runs",
          ),
        );
      } else {
        parts.push("`agent_runs` missing — orchestrator run counts unavailable.");
      }

      if (!worst) {
        return failure(
          `Cannot assess DO runaway: ${parts.join(" ")} Run \`pnpm run migrate:remote\` and re-check.`,
        );
      }
      return { result: (worst as HealthProbeOutcome).result, details: parts.join(" ") };
    },
  }),

  defineProbe({
    name: "usage_circuit_breaker_state",
    displayName: "Spend circuit-breaker state",
    description:
      "Reads the metering config from `project_system_variables` and this cycle's spend per provider in ONE grouped query, then reports any provider that is manually broken, over its ceiling, snoozed, or running with no ceiling configured.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "Every metered provider has a non-zero ceiling, none is manually broken, none is snoozed, and none has reached its ceiling this billing cycle. `canSpend()` is returning `allowed` for all of them, so no feature is being silently denied for spend reasons.",
    whatFailureMeans:
      "At least one provider has hit its ceiling, so `canSpend()` now DENIES every call to it and `meteredAiRun()` throws `SpendBlockedError`. The user-visible symptom is a feature that 'just stopped working' with no error on screen, because most AI work happens in background tasks. A provider with a ceiling of 0 (unlimited) is reported as DEGRADED for the opposite reason: it is unbrakeable, which is exactly the state that produced the original runaway.",
    troubleshootingSteps:
      "1. The details name each affected provider and its numbers. Decide first whether the ceiling was reached legitimately (a heavy but intended week) or by a runaway — check the spend-spike probe on this same page before raising anything. 2. Inspect the live config: `npx wrangler d1 execute core-remodel --remote --command \"SELECT variable_key, value_text FROM project_system_variables WHERE category='usage_metering' ORDER BY variable_key\"`. 3. To grant a bounded increase use `snooze(env, provider, amountUsd)` — it raises the ceiling to CURRENT SPEND + amount, so 'snooze $10' always buys exactly $10 more and the breaker trips again at the new number. Do not raise `threshold_usd` as a reflex; that change is permanent and silent. 4. A `manual_break` set to true was someone deliberately pulling the handle — find out who and why before clearing it. 5. Remember the breaker FAILS CLOSED: if it cannot read spend it denies everything, so a D1 read problem presents as every provider blocked at once.",
    devOpsPlaybook:
      "1. Correlate with the spend/token spike probes before touching the ceiling — clearing a breaker that is correctly holding back a runaway converts a stopped feature into an open invoice. 2. Legitimate overage: `snooze` for a bounded raise, or update `usage.<PROVIDER>.threshold_usd` in `project_system_variables` if the ceiling was genuinely mis-set. 3. Runaway: leave the breaker tripped, fix the driver, deploy, then clear with `resetBreaker`. 4. Unconfigured ceiling (0): set a real `threshold_usd` — an unlimited provider is how this incident class starts. 5. Re-run this probe after any config change to confirm the state you intended.",
    isBillingRisk: true,
    severity: "HIGH",
    run: async (env) => {
      const cfg = await getMeteringConfig(env);
      const start = Math.floor(cycleStart(cfg.cycleAnchorDay).getTime() / 1000);

      // ONE grouped query, deliberately. Seven per-provider scans of an
      // append-only ledger is the very cost pattern this module polices.
      const spendByProvider = new Map<string, number>();
      if (await tableExists(env.DB, "gemini_usage_log")) {
        const { results } = await env.DB.prepare(
          "SELECT provider, COALESCE(SUM(estimated_cost_usd), 0) AS spend FROM gemini_usage_log WHERE timestamp >= ? GROUP BY provider",
        )
          .bind(start)
          .all<{ provider: string; spend: number }>();
        for (const r of results ?? []) spendByProvider.set(r.provider, Number(r.spend) || 0);
      } else {
        return failure(
          "Table `gemini_usage_log` does not exist, so spend is unreadable. The breaker FAILS CLOSED on an unreadable ledger — every metered provider is currently denied. Run `pnpm run migrate:remote`.",
        );
      }

      const blocked: string[] = [];
      const warnings: string[] = [];
      for (const provider of METERED_PROVIDERS) {
        const pc = cfg.providers[provider];
        const spend = spendByProvider.get(provider) ?? 0;
        const ceiling = pc.snoozeToUsd !== null ? pc.snoozeToUsd : pc.thresholdUsd;

        if (pc.manualBreak) {
          blocked.push(`${provider}: MANUAL BREAK (spend $${spend.toFixed(2)})`);
          continue;
        }
        if (ceiling <= 0) {
          warnings.push(`${provider}: no ceiling configured (unlimited, spend $${spend.toFixed(2)})`);
          continue;
        }
        if (spend >= ceiling) {
          blocked.push(
            `${provider}: OVER CEILING $${spend.toFixed(2)} of $${ceiling.toFixed(2)} — calls denied`,
          );
          continue;
        }
        if (pc.snoozeToUsd !== null) {
          warnings.push(
            `${provider}: snoozed to $${pc.snoozeToUsd.toFixed(2)} (spend $${spend.toFixed(2)})`,
          );
        }
      }

      const cycleLabel = `cycle anchored on day ${cfg.cycleAnchorDay}`;
      if (blocked.length > 0) {
        return failure(
          `${blocked.length} provider(s) BLOCKED (${cycleLabel}) — ${blocked.join("; ")}.${warnings.length ? ` Also: ${warnings.join("; ")}.` : ""}`,
        );
      }
      if (warnings.length > 0) {
        return degraded(`Breaker warnings (${cycleLabel}) — ${warnings.join("; ")}.`);
      }
      return ok(
        `All ${METERED_PROVIDERS.length} metered providers under ceiling with no manual break (${cycleLabel}).`,
      );
    },
  }),

  defineProbe({
    name: "usage_logging_liveness",
    displayName: "Usage logging liveness (24h)",
    description:
      "Counts rows written to `gemini_usage_log` in the last 24h. Zero rows is DEGRADED — not because idleness is a fault, but because a silent writer and an idle system are indistinguishable from the outside, and one of them means spend is happening unmetered.",
    healthTsFilepath: FILE,
    bindingTypesTested: ["d1"],
    whatSuccessMeans:
      "The usage ledger is receiving rows, so the metering wrappers are running and every spend-based probe and the circuit breaker have real data underneath them. Without this, all the other numbers on this page are confidently wrong.",
    whatFailureMeans:
      "Nothing has been logged for a day. Either the app genuinely made no metered calls, or `recordUsage()` is failing — and it swallows its own errors by design so that a metering failure never takes down the call it is measuring. That design choice is correct and it is also exactly why this probe must exist: a broken writer produces silence, not errors. Silence here also poisons every baseline: a quiet week makes the next real spike look like a 100x jump.",
    troubleshootingSteps:
      "1. Establish whether calls are actually happening, from a source other than D1: Cloudflare dashboard > AI > AI Gateway > core-remodel and AI > Workers AI, plus `npx wrangler tail` on the live worker while you trigger an AI-backed action. 2. Traffic there but nothing in D1 = broken writer. Tail and grep for the `[metering] FAILED to record` prefix — that is the only trace it leaves. 3. No traffic anywhere = genuinely idle; note it and move on, but be sceptical of the next spike ratio. 4. Confirm the table is real and readable: `npx wrangler d1 execute core-remodel --remote --command \"SELECT COUNT(*), MAX(timestamp) FROM gemini_usage_log\"`. 5. Remember metering adoption is incremental — paths still calling `env.AI.run` directly instead of `meteredAiRun()` never write rows, so a partial silence can be entirely expected. Check whether the busy path was ever wrapped.",
    devOpsPlaybook:
      "1. Distinguish idle from broken using the dashboard-vs-D1 comparison before anything else. 2. Broken writer: fix and deploy (`pnpm run deploy`), then confirm a fresh row appears within minutes of an AI-backed action. 3. If the table is missing, that is a deploy-order fault — `pnpm run migrate:remote` and verify, because new code reaching production before its table exists is the standard cause of a 500 right after a schema change. 4. After recovery, treat the first 7 days of baselines as unreliable and read the spike probes with that in mind. 5. Genuinely idle needs no action, but do not clear the DEGRADED without recording why.",
    isBillingRisk: true,
    severity: "HIGH",
    run: async (env) => {
      const db = env.DB;
      if (!(await tableExists(db, "gemini_usage_log"))) {
        return failure(
          "Table `gemini_usage_log` does not exist — nothing can be metered and the breaker fails closed. Run `pnpm run migrate:remote`.",
        );
      }
      const last24 = await scalar(
        db,
        "SELECT COUNT(*) FROM gemini_usage_log WHERE timestamp >= unixepoch() - 86400",
      );
      if (last24 === 0) {
        const newest = await scalar(db, "SELECT COALESCE(MAX(timestamp), 0) FROM gemini_usage_log");
        if (newest === 0) {
          return degraded(
            "The usage ledger has NEVER received a row. Either metering has not been adopted on any live path, or the writer has never worked — spend is completely unmetered either way.",
          );
        }
        const ageDays = (Date.now() / 1000 - newest) / 86400;
        return degraded(
          `No usage rows in the last 24h; the most recent row is ${ageDays.toFixed(1)} day(s) old. Idle system or silent writer — confirm against the Cloudflare AI dashboard before dismissing.`,
        );
      }
      const errors = await scalar(
        db,
        "SELECT COUNT(*) FROM gemini_usage_log WHERE status = 'error' AND timestamp >= unixepoch() - 86400",
      );
      const errPct = Math.round((errors / last24) * 100);
      const detail = `${last24} usage rows written in the last 24h, ${errors} with status='error' (${errPct}%).`;
      if (errPct > 50) {
        return degraded(
          `${detail} A majority-error ledger usually means a retry storm against a failing upstream — billable attempts with no useful output.`,
        );
      }
      return ok(detail);
    },
  }),
];
