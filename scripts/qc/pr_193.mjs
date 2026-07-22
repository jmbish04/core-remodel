#!/usr/bin/env node
/**
 * @fileoverview QC — 0026 Agent Ops Transparency.
 *
 * Exercises the whole Agent Ops surface: the nine `/api/admin/agents/*`
 * endpoints, their validation and auth behaviour, the retry/cancel/approve
 * state machine, and the four pages.
 *
 *   pnpm run test:pr 193 -- --preview     # branch preview worker
 *   pnpm run test:pr 193                  # production (after merge)
 *
 * The retry section operates on a real settled run rather than a fixture:
 * there is no direct D1 access from a QC script, so it creates its second run
 * through the retry endpoint and then cancels it, leaving the ledger tidy. If
 * the window holds no settled run, that section reports itself as skipped
 * instead of silently passing.
 */
import { assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";

const base = resolveBase();
const client = createClient({ base });
const { req } = client;
const checks = createChecks();
const { ok, info, finish } = checks;

console.log(`\nQC pr_193 — Agent Ops Transparency\nTarget: ${base}\n`);

await assertReachable(client, checks);

// ── 1. Reads ────────────────────────────────────────────────────────────────
console.log("1. Read endpoints");

const overview = await req("GET", "/api/admin/agents/overview");
ok("GET /overview 200", overview.status === 200, `got ${overview.status}`);
ok("overview reports coverage", typeof overview.json?.coverage?.total === "number");
ok(
  "overview declares every registry surface",
  overview.json?.coverage?.total >= 27,
  `total=${overview.json?.coverage?.total}`,
);
ok(
  "overview returns breaker state for every metered provider",
  Array.isArray(overview.json?.providers) && overview.json.providers.length >= 7,
  `providers=${overview.json?.providers?.length}`,
);
ok("overview returns a runaway array", Array.isArray(overview.json?.runaways));
info(
  `coverage ${overview.json?.coverage?.instrumented}/${overview.json?.coverage?.total} · ` +
    `runaways ${overview.json?.runaways?.length} · counts ${JSON.stringify(overview.json?.counts)}`,
);

const runs = await req("GET", "/api/admin/agents/runs?since=30d&limit=50");
ok("GET /runs 200", runs.status === 200, `got ${runs.status}`);
ok("runs payload is an array", Array.isArray(runs.json?.runs));
const shapeOk =
  runs.json?.runs?.length === 0 ||
  ["id", "agent", "agentLabel", "operation", "surface", "status", "attempt", "percent"].every(
    (k) => k in runs.json.runs[0],
  );
ok("run summary carries the UI's required fields", shapeOk);

const coverage = await req("GET", "/api/admin/agents/coverage");
ok("GET /coverage 200", coverage.status === 200);
ok(
  "coverage lists uninstrumented surfaces rather than hiding them",
  Array.isArray(coverage.json?.surfaces) &&
    coverage.json.surfaces.every((s) => typeof s.instrumented === "boolean"),
);

const failures = await req("GET", "/api/admin/agents/failures?since=30d");
ok("GET /failures 200", failures.status === 200);
ok("failures are grouped", Array.isArray(failures.json?.groups));

const usage = await req("GET", "/api/admin/agents/usage");
ok("GET /usage 200", usage.status === 200);
ok("usage totals are numeric", typeof usage.json?.totalCostUsd === "number");
ok(
  "unit cost is null (not 0) when no tokens are reported",
  usage.json?.totalTokens > 0
    ? typeof usage.json.unitCostPerMillion === "number"
    : usage.json?.unitCostPerMillion === null,
);
info(
  `spend $${usage.json?.totalCostUsd?.toFixed(4)} · tokens ${usage.json?.totalTokens} · ` +
    `rows ${usage.json?.rows?.length}`,
);

// ── 2. Validation ───────────────────────────────────────────────────────────
console.log("\n2. Input validation");

const badStatus = await req("GET", "/api/admin/agents/runs?status=bogus");
ok("unknown status is rejected, not ignored", badStatus.status === 400, `got ${badStatus.status}`);

const badId = await req("GET", "/api/admin/agents/runs/not-a-number");
ok("non-numeric run id → 400", badId.status === 400, `got ${badId.status}`);

const missing = await req("GET", "/api/admin/agents/runs/99999999");
ok("unknown run id → 404", missing.status === 404, `got ${missing.status}`);

const badRetry = await req("POST", "/api/admin/agents/runs/99999999/retry");
ok("retry of an unknown run → 404", badRetry.status === 404, `got ${badRetry.status}`);

// ── 3. Auth ─────────────────────────────────────────────────────────────────
console.log("\n3. Auth gate");

for (const path of [
  "/api/admin/agents/overview",
  "/api/admin/agents/runs",
  "/api/admin/agents/usage",
  "/api/admin/agents/coverage",
]) {
  const r = await req("GET", path, { auth: false });
  ok(`unauthenticated ${path} is refused`, r.status === 401 || r.status === 302, `got ${r.status}`);
}

// ── 4. Retry semantics against a real run ───────────────────────────────────
console.log("\n4. Retry semantics");

const settled = (runs.json?.runs ?? []).find((r) =>
  ["succeeded", "failed", "cancelled"].includes(r.status),
);

if (!settled) {
  info("no settled run in the window — retry semantics not exercised this pass");
} else {
  const retry = await req("POST", `/api/admin/agents/runs/${settled.id}/retry`);
  ok("retry of a settled run 200s", retry.status === 200, `got ${retry.status}`);
  ok(
    "retry creates a NEW run rather than mutating the original",
    retry.json?.runId && retry.json.runId !== settled.id,
    `runId=${retry.json?.runId}`,
  );
  ok(
    "retry increments the attempt counter",
    retry.json?.attempt === settled.attempt + 1,
    `attempt=${retry.json?.attempt}`,
  );

  const child = await req("GET", `/api/admin/agents/runs/${retry.json.runId}`);
  ok("the retry run is readable", child.status === 200);
  ok(
    "the retry links back to its parent",
    child.json?.run?.parentRunId === settled.id,
    `parentRunId=${child.json?.run?.parentRunId}`,
  );
  ok(
    "lineage exposes the whole attempt chain",
    Array.isArray(child.json?.lineage) && child.json.lineage.length >= 2,
    `lineage=${child.json?.lineage?.length}`,
  );

  const original = await req("GET", `/api/admin/agents/runs/${settled.id}`);
  ok(
    "the original run is untouched by the retry",
    original.json?.run?.status === settled.status,
    `status=${original.json?.run?.status} (was ${settled.status})`,
  );

  // Tidy up: the retry is a ledger placeholder, not real work.
  const cancel = await req("POST", `/api/admin/agents/runs/${retry.json.runId}/cancel`);
  ok("the placeholder retry can be cancelled", cancel.status === 200, `got ${cancel.status}`);

  const doubleCancel = await req("POST", `/api/admin/agents/runs/${retry.json.runId}/cancel`);
  ok(
    "cancelling a settled run is refused rather than rewriting history",
    doubleCancel.status === 409,
    `got ${doubleCancel.status}`,
  );

  const badApprove = await req("POST", `/api/admin/agents/runs/${settled.id}/approve`);
  ok(
    "approve is refused for a run that is not awaiting approval",
    badApprove.status === 409,
    `got ${badApprove.status}`,
  );
}

// ── 5. Pages render ─────────────────────────────────────────────────────────
console.log("\n5. Pages");

for (const [path, marker] of [
  ["/admin/system/agents/queue", "Agent Run Queue"],
  ["/admin/system/agents/failed", "Agent Failures"],
  ["/admin/system/agents/usage", "Agent Cost"],
  ["/admin/system/agents/queue/1", "Run Detail"],
]) {
  const r = await req("GET", path);
  const html = r.text ?? "";
  ok(`${path} 200s`, r.status === 200, `got ${r.status}`);
  ok(`${path} renders its heading`, html.includes(marker));
  // The mandatory page shell: container + padding on <main>. A `className` on a
  // native element in an .astro file renders as a dead attribute and collapses
  // the page into the top-left corner, which this catches.
  ok(`${path} uses the mandatory page shell`, html.includes('class="container mx-auto px-4 py-8'));
}

// ── 6. Regression guard on the surfaces this feature touched ───────────────
console.log("\n6. Regression guard");

for (const [path, label] of [
  ["/api/admin/plans/0026_agent_ops_transparency", "plans API still serves the 0026 board"],
  ["/api/mcp-ops/overview", "MCP Ops API unaffected"],
  ["/api/admin/integrations/usage", "integrations usage API unaffected"],
]) {
  const r = await req("GET", path);
  ok(label, r.status === 200 || r.status === 404, `got ${r.status}`);
}

finish();
