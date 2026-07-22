#!/usr/bin/env node
/**
 * @fileoverview QC for PR #195 — the health platform (0028).
 *
 * Covers the new admin-gated surface (`/api/health/session`, `/session/latest`,
 * `/sessions`, `/catalogue`, `/badge`), the page move to `/admin/system/health`,
 * and the D1 session ledger. Plus regression guards on everything the PR could
 * have broken: the PUBLIC `GET /api/health` that external uptime monitors read,
 * `POST /api/health/run` (the 0027 five-binding screen), and `/api/system/health`
 * (the data-quality registry from #169, which this PR bridges but must not break).
 *
 * Against PRODUCTION before the merge, the new endpoints legitimately 404 — that
 * is reported as "pending merge/deploy", not a failure. Everything else must pass
 * on both targets.
 *
 *   pnpm run test:pr 195 -- --preview   # this branch
 *   pnpm run test:pr 195                # production (regression guard, then re-run after deploy)
 */

import { assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";

const base = resolveBase();
const client = createClient({ base });
const checks = createChecks();
const isPreview = process.argv.includes("--preview");

/** New-in-this-PR endpoints legitimately do not exist on prod until it merges. */
function pendingDeploy(name, status) {
  if (!isPreview && (status === 404 || status === 405)) {
    checks.info(`⏳ ${name} — pending merge/deploy (HTTP ${status} on production)`);
    return true;
  }
  return false;
}

console.log(`\nQC pr_195 — health platform\ntarget: ${base}\n`);
await assertReachable(client, checks);

// ─── Regression: the public surface must not have moved ─────────────────────
console.log("\nRegression — public health endpoints (uptime monitors read these)");
{
  const r = await client.get("/api/health", { auth: false });
  checks.ok("GET /api/health is public and 200", r.status === 200, `HTTP ${r.status}`);
  checks.ok(
    "GET /api/health still returns status + services",
    Boolean(r.json?.status) && typeof r.json?.services === "object",
    JSON.stringify(r.json)?.slice(0, 160),
  );

  const run = await client.post("/api/health/run", undefined, { auth: false });
  checks.ok("POST /api/health/run (0027 screen) still works", run.status === 200, `HTTP ${run.status}`);
  checks.ok(
    "…and still returns per-binding checks",
    Array.isArray(run.json?.checks) && run.json.checks.length >= 4,
    `checks=${run.json?.checks?.length}`,
  );
}

// ─── Regression: the #169 data-quality registry ─────────────────────────────
console.log("\nRegression — #169 data-quality registry (bridged, must still stand alone)");
{
  const r = await client.get("/api/system/health/checks");
  checks.ok("GET /api/system/health/checks → 200", r.status === 200, `HTTP ${r.status}`);
  checks.ok(
    "…registry is non-empty",
    Array.isArray(r.json?.checks) && r.json.checks.length > 0,
    `checks=${r.json?.checks?.length}`,
  );
}

// ─── Auth gate ───────────────────────────────────────────────────────────────
console.log("\nAuth — the catalogue is a map of internal infrastructure, so it is gated");
{
  const unauth = await client.post("/api/health/session", undefined, { auth: false });
  if (!pendingDeploy("POST /api/health/session (unauthed)", unauth.status)) {
    checks.ok("POST /api/health/session unauthed → 401", unauth.status === 401, `HTTP ${unauth.status}`);
  }
  const cat = await client.get("/api/health/catalogue", { auth: false });
  if (!pendingDeploy("GET /api/health/catalogue (unauthed)", cat.status)) {
    checks.ok("GET /api/health/catalogue unauthed → 401", cat.status === 401, `HTTP ${cat.status}`);
  }
}

// ─── Catalogue ───────────────────────────────────────────────────────────────
console.log("\nCatalogue — every test carries its own runbook");
let catalogueTests = [];
{
  const r = await client.get("/api/health/catalogue");
  if (!pendingDeploy("GET /api/health/catalogue", r.status)) {
    checks.ok("GET /api/health/catalogue → 200", r.status === 200, `HTTP ${r.status}`);
    const groups = r.json?.groups ?? [];
    catalogueTests = groups.flatMap((g) => g.tests ?? []);
    checks.ok("catalogue is grouped", groups.length >= 8, `groups=${groups.length}`);
    checks.ok("catalogue is substantial", catalogueTests.length >= 80, `tests=${catalogueTests.length}`);
    checks.info(groups.map((g) => `${g.id}:${g.tests.length}`).join(" "));

    // The runbook fields are the whole point — an empty one is a defect, not a nit.
    const FIELDS = [
      "description",
      "whatSuccessMeans",
      "whatFailureMeans",
      "troubleshootingSteps",
      "devOpsPlaybook",
      "healthTsFilepath",
    ];
    const bare = catalogueTests.filter((t) => FIELDS.some((f) => !t[f] || String(t[f]).length < 20));
    checks.ok(
      "every test has a populated runbook",
      bare.length === 0,
      bare.map((t) => t.name).join(", "),
    );

    const badSeverity = catalogueTests.filter((t) => !["HIGH", "MEDIUM", "LOW"].includes(t.severity));
    checks.ok("severity is always a valid enum value", badSeverity.length === 0,
      badSeverity.map((t) => t.name).join(", "));

    const names = catalogueTests.map((t) => t.name);
    checks.ok("test names are unique", new Set(names).size === names.length);

    const billing = catalogueTests.filter((t) => t.isBillingRisk);
    checks.ok("cost watchers exist", billing.length >= 5, `billing-risk tests=${billing.length}`);
    checks.info(`cost watchers: ${billing.map((t) => t.name).join(", ")}`);

    const quality = groups.find((g) => g.id === "quality");
    checks.ok(
      "the #169 data-quality checks are bridged in",
      Boolean(quality) && quality.tests.length > 0,
      `quality tests=${quality?.tests?.length ?? 0}`,
    );
  }
}

// ─── A live session ──────────────────────────────────────────────────────────
console.log("\nSession — run every probe for real");
let session = null;
{
  const t0 = Date.now();
  const r = await client.post("/api/health/session");
  const wall = Date.now() - t0;
  if (!pendingDeploy("POST /api/health/session", r.status)) {
    checks.ok("POST /api/health/session → 200 even when probes fail", r.status === 200, `HTTP ${r.status}`);
    session = r.json;
    checks.ok("session returns a uuid", Boolean(session?.sessionUuid));
    checks.ok(
      "every catalogued test ran",
      Array.isArray(session?.runs) && session.runs.length === catalogueTests.length,
      `runs=${session?.runs?.length} catalogue=${catalogueTests.length}`,
    );
    checks.ok(
      "overall is a valid roll-up",
      ["SUCCESS", "DEGRADED", "FAILURE"].includes(session?.overall),
      String(session?.overall),
    );
    const sum =
      (session?.counts?.success ?? 0) + (session?.counts?.degraded ?? 0) + (session?.counts?.failure ?? 0);
    checks.ok("counts sum to the run count", sum === session?.runs?.length, `${sum} vs ${session?.runs?.length}`);
    checks.ok(
      "every run carries details",
      (session?.runs ?? []).every((x) => typeof x.details === "string" && x.details.length > 0),
    );
    // The whole screen is meant to be cheap enough to click repeatedly.
    checks.ok("the screen is fast (< 20s wall)", wall < 20_000, `${wall} ms`);
    checks.info(`overall=${session?.overall} counts=${JSON.stringify(session?.counts)} wall=${wall}ms`);
    for (const x of (session?.runs ?? []).filter((x) => x.result !== "SUCCESS")) {
      checks.info(`${x.result} ${x.name} :: ${String(x.details).slice(0, 140)}`);
    }
  }
}

// ─── The ledger ──────────────────────────────────────────────────────────────
console.log("\nLedger — the session must be persisted, not just returned");
{
  const r = await client.get("/api/health/session/latest");
  if (!pendingDeploy("GET /api/health/session/latest", r.status)) {
    checks.ok("GET /api/health/session/latest → 200", r.status === 200, `HTTP ${r.status}`);
    if (session) {
      checks.ok(
        "the run we just made is the latest persisted session",
        r.json?.session?.sessionUuid === session.sessionUuid,
        `${r.json?.session?.sessionUuid} vs ${session.sessionUuid}`,
      );
      checks.ok(
        "…with every row persisted",
        r.json?.session?.runs?.length === session.runs.length,
        `${r.json?.session?.runs?.length} vs ${session.runs.length}`,
      );
    }
  }

  const list = await client.get("/api/health/sessions?limit=5");
  if (!pendingDeploy("GET /api/health/sessions", list.status)) {
    checks.ok("GET /api/health/sessions → 200", list.status === 200, `HTTP ${list.status}`);
    checks.ok("history is grouped by session", Array.isArray(list.json?.sessions) && list.json.sessions.length > 0,
      `sessions=${list.json?.sessions?.length}`);
    const uuids = (list.json?.sessions ?? []).map((s) => s.sessionUuid);
    checks.ok("sessions are distinct", new Set(uuids).size === uuids.length);
  }
}

// ─── The header badge ────────────────────────────────────────────────────────
console.log("\nBadge — cheap, and never triggers a probe");
{
  const r = await client.get("/api/health/badge");
  if (!pendingDeploy("GET /api/health/badge", r.status)) {
    checks.ok("GET /api/health/badge → 200", r.status === 200, `HTTP ${r.status}`);
    checks.ok(
      "badge reports the latest session's status",
      !session || r.json?.status === session.overall,
      `${r.json?.status} vs ${session?.overall}`,
    );
    const anon = await client.get("/api/health/badge", { auth: false });
    checks.ok(
      "badge is null for an unauthed request (renders nothing, never leaks)",
      anon.status === 200 && anon.json?.status === null,
      `HTTP ${anon.status} ${JSON.stringify(anon.json)?.slice(0, 80)}`,
    );
  }
}

// ─── Pages ───────────────────────────────────────────────────────────────────
console.log("\nPages — the dashboard moved behind the admin gate");
{
  const page = await client.get("/admin/system/health");
  checks.ok("/admin/system/health renders for an admin", page.status === 200, `HTTP ${page.status}`);
  checks.ok(
    "…and mounts the dashboard island",
    page.text.includes("System Health"),
    page.text.slice(0, 120),
  );

  // Assert on the 301 itself, not the followed request — production still serves
  // the OLD public /health page until this merges, so a non-301 there is
  // "pending", not a failure.
  for (const from of ["/health", "/admin/health"]) {
    const res = await fetch(`${base}${from}`, { redirect: "manual" });
    const loc = res.headers.get("location") ?? "";
    const landed = res.status === 301 && loc.endsWith("/admin/system/health");
    if (!isPreview && !landed) {
      checks.info(`⏳ ${from} redirect — pending merge/deploy (HTTP ${res.status} → ${loc || "—"})`);
      continue;
    }
    checks.ok(`${from} → /admin/system/health`, landed, `HTTP ${res.status} → ${loc}`);
  }
}

checks.finish();
