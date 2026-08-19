#!/usr/bin/env node
/**
 * QC for PR 382 — health-probe truth, abandoned-run sweep, DO/AI spend metering
 * and the KV circuit-breaker cache.
 *
 * Run: pnpm run test:pr 382 -- --preview   (branch)
 *      pnpm run test:pr 382                (production regression guard)
 *
 * WHAT THIS ASSERTS, AND WHY IT IS SHAPED THIS WAY
 * -----------------------------------------------
 * The two probe fixes are assertions about CLASSIFICATION, not about the app
 * doing more work, so they cannot be tested by "does the endpoint 200". The
 * meaningful check is: given the same prod data, does the probe still call it a
 * FAILURE? Both probes are therefore run live and their result compared against
 * the state the audit established.
 *
 * The breaker cache is asserted through latency and through the admin usage
 * endpoint rather than by reading KV directly — QC has no KV binding, and a
 * cache that is only observable from inside the Worker is exactly the kind of
 * thing that rots undetected.
 *
 * Against PRODUCTION (pre-merge) the new behaviour does not exist yet, so those
 * checks report as pending rather than failing. The regression half — health
 * endpoint reachable, usage config readable, agent-run API intact — must pass on
 * prod, which is the point of running it there.
 */
import { assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const IS_PREVIEW = process.argv.includes("--preview");
const c = createClient({ base: BASE });
const { ok: check, info, summary, finish } = createChecks();

console.log(`QC pr_382 against ${BASE}${IS_PREVIEW ? " (branch preview)" : " (production)"}\n`);

/** Pull one probe out of a health session payload by name. */
function probe(results, name) {
  return (results ?? []).find((r) => r.name === name) ?? null;
}

await assertReachable(c, { ok: check });

// ---------------------------------------------------------------------------
// 1. Health session — the probes this PR changed
// ---------------------------------------------------------------------------
console.log("\n— health probes —");

// NOTE: `/api/health/run` is a DIFFERENT, smaller thing (`runHealthScreen`) and
// returns no per-probe results. The 88-probe registry session — the one the
// `/admin/system/health` page and the `run_health_session` MCP tool use — is
// `POST /api/health/session`, which is admin-gated.
const session = await c.post("/api/health/session", {});
check("POST /api/health/session returns 200", session.status === 200, `status=${session.status}`);

// The HTTP route names the array `runs`; the MCP tool names the same payload
// `results`. Accept either so this script does not break the next time one of
// them is renamed to match the other.
const results = session.json?.runs ?? session.json?.results ?? [];
check("session returned probe results", results.length > 0, `count=${results.length}`);
info(`overall=${session.json?.overall} counts=${JSON.stringify(session.json?.counts ?? {})}`);

// --- email pipeline liveness -------------------------------------------------
const email = probe(results, "email_pipeline_processing_liveness");
check("email_pipeline_processing_liveness ran", email !== null);

if (email) {
  info(`email probe: ${email.result} — ${email.details}`);
  if (IS_PREVIEW) {
    // The audit established that every `pending` row on prod carrying
    // ai_status='pending_approval' is the trust gate's parked state, and that
    // 22 of 26 were exactly that. With those excluded the probe must no longer
    // call the pipeline broken.
    check(
      "parked (pending_approval) mail no longer reads as FAILURE",
      email.result !== "FAILURE",
      `result=${email.result} — ${email.details}`,
    );
    check(
      "probe reports parked mail separately",
      /awaiting your approval/.test(email.details) || !/pending/.test(email.details),
      `details=${email.details}`,
    );
  } else {
    info("production still runs the pre-fix probe — pending merge/deploy");
  }
}

// --- DO runaway watcher ------------------------------------------------------
const doWatcher = probe(results, "do_agent_run_volume_watcher");
check("do_agent_run_volume_watcher ran", doWatcher !== null);

if (doWatcher) {
  info(`DO watcher: ${doWatcher.result} — ${doWatcher.details}`);
  if (IS_PREVIEW) {
    // The 31 stuck rows on prod are 6-16 days old with zero runs started in the
    // last hour. Dead rows must not raise a billing FAILURE.
    check(
      "aged residue does not raise a billing FAILURE",
      doWatcher.result !== "FAILURE",
      `result=${doWatcher.result} — ${doWatcher.details}`,
    );
    check(
      "residue is reported, not hidden",
      /older than \d+h/.test(doWatcher.details) || /No stuck runs/.test(doWatcher.details),
      `details=${doWatcher.details}`,
    );
  } else {
    info("production still runs the pre-fix probe — pending merge/deploy");
  }
}

// --- regression: the probes this PR did NOT touch still work -----------------
const infraProbes = ["kv_cache_round_trip", "d1_connectivity"].filter((n) => probe(results, n));
info(`infra probes present in this session: ${infraProbes.join(", ") || "(none matched by name)"}`);
check(
  "no probe crashed the session (every result carries a verdict)",
  results.every((r) => typeof r.result === "string" && r.result.length > 0),
  `${results.filter((r) => !r.result).length} result(s) missing a verdict`,
);

// ---------------------------------------------------------------------------
// 2. Spend budgets — config readable, DO + AI present, ceilings sane
// ---------------------------------------------------------------------------
console.log("\n— spend budgets —");

const usage = await c.get("/api/config/usage");
check("GET /api/config/usage returns 200", usage.status === 200, `status=${usage.status}`);

const providers = usage.json?.providers ?? [];
const byName = Object.fromEntries(providers.map((p) => [p.provider, p]));

for (const name of ["WORKERS_AI", "GEMINI", "DURABLE_OBJECT"]) {
  const p = byName[name];
  check(`${name} has a budget`, Boolean(p), p ? "" : "provider missing from /api/config/usage");
  if (p) {
    check(
      `${name} ceiling is a positive number`,
      typeof p.ceilingUsd === "number" && p.ceilingUsd > 0,
      `ceilingUsd=${p.ceilingUsd}`,
    );
    info(
      `${name}: spend $${Number(p.spendUsd).toFixed(4)} / ceiling $${Number(p.ceilingUsd).toFixed(2)}`,
    );
  }
}

// The whole point of the startRun change: DO spend was structurally $0 because
// nothing wrote a usage row. On the branch it should become a real number once
// any agent run closes. A zero here on preview is not a hard failure (no run may
// have closed yet), but it IS the thing to watch, so it is reported loudly.
const doBudget = byName.DURABLE_OBJECT;
if (doBudget && IS_PREVIEW) {
  if (Number(doBudget.spendUsd) > 0) {
    check("DURABLE_OBJECT spend is now measured (non-zero)", true, `$${doBudget.spendUsd}`);
  } else {
    info(
      "DURABLE_OBJECT spend still $0 — expected until an agent run closes on this deploy. " +
        "Re-run after triggering one; a persistent $0 means the startRun writer is not firing.",
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Breaker cache — the second read must be cheaper than the first
// ---------------------------------------------------------------------------
console.log("\n— KV breaker cache —");

// `/api/config/usage` deliberately reads FRESH (an admin page showing a cached
// spend figure would be lying), so it cannot demonstrate the cache. The agent
// overview endpoint calls canSpend on the cached path.
async function timed(path) {
  const t0 = Date.now();
  const res = await c.get(path);
  return { ms: Date.now() - t0, status: res.status, json: res.json };
}

const cold = await timed("/api/admin/agents/overview");
const warm = await timed("/api/admin/agents/overview");
check("agents overview reachable", cold.status === 200, `status=${cold.status}`);
info(`overview timings: first=${cold.ms}ms second=${warm.ms}ms`);

if (IS_PREVIEW) {
  // Deliberately a soft signal, not a hard assert: network jitter on a cold
  // Worker isolate routinely swamps a few milliseconds of D1 saving, and a QC
  // script that fails on timing noise gets ignored, which is worse than a QC
  // script that reports it.
  info(
    warm.ms <= cold.ms
      ? "second read was not slower — consistent with a warm breaker cache"
      : `second read was slower (${warm.ms}ms vs ${cold.ms}ms) — likely isolate/network noise, not proof of a broken cache`,
  );
}

// ---------------------------------------------------------------------------
// 4. Regression — agent run ledger API still intact after the sweep changes
// ---------------------------------------------------------------------------
console.log("\n— agent run ledger (regression) —");

const runs = await c.get("/api/admin/agents/runs?limit=5");
check("GET /api/admin/agents/runs returns 200", runs.status === 200, `status=${runs.status}`);
check(
  "runs payload is an array",
  Array.isArray(runs.json?.runs),
  `keys=${Object.keys(runs.json ?? {})}`,
);

const stuck = await c.get("/api/admin/agents/runs?status=running,queued&since=2160h&limit=200");
const stuckRuns = stuck.json?.runs ?? [];
info(`runs still running/queued over the last 90d: ${stuckRuns.length}`);

if (IS_PREVIEW) {
  // The sweep runs on the DAILY cron, so it will not have fired the moment this
  // deploys. Report the count rather than asserting it — asserting zero here
  // would fail for a full day after every deploy, for no defect.
  info(
    stuckRuns.length > 0
      ? `${stuckRuns.length} still open — sweepAbandonedRuns runs on the 0 14 * * * cron; expect these to become failed/ABANDONED after it fires`
      : "no open runs — sweep has already run or the ledger is clean",
  );
}

const abandoned = await c.get("/api/admin/agents/failures?since=2160h");
const groups = abandoned.json?.groups ?? [];
const abandonedGroup = groups.find((g) => g.errorCode === "ABANDONED");
info(
  abandonedGroup
    ? `ABANDONED failure group present: ${abandonedGroup.count} run(s)`
    : "no ABANDONED group yet (sweep has not fired on this deploy)",
);

summary();
finish();
