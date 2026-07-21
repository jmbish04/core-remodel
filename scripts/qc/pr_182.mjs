#!/usr/bin/env node
/**
 * @fileoverview QC — PR #182, public /health page + on-demand health screen.
 *
 *   pnpm run test:pr 182 -- --preview   # this branch's preview worker (new surface)
 *   pnpm run test:pr 182                 # production — the /health page + /run
 *                                        # report PENDING until merge+deploy
 *
 * All endpoints here are PUBLIC (no admin cookie), so the checks run without auth.
 * On the production target, the new POST /api/health/run and the /health page 404
 * until this merges and deploys — reported as PENDING, not a hard failure.
 */
import { createClient, createChecks, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(`\nQC pr_182 — /health\n  target: ${resolveBase()}${onProd ? " (PROD — new surface reports PENDING until merge+deploy)" : ""}\n`);

// GET /api/health already exists on prod — a real regression guard everywhere.
const health = await client.get("/api/health", { auth: false });
checks.ok(
  "GET /api/health → 200 with a status string (regression)",
  health.status === 200 && typeof health.json?.status === "string",
  `→ ${health.status}`,
);

// New: the on-demand screen.
const run = await client.post("/api/health/run", {}, { auth: false });
if (onProd && run.status === 404) {
  checks.info("PENDING (prod): POST /api/health/run not deployed yet — expected before merge.");
} else {
  const okRun = checks.ok(
    "POST /api/health/run → 200 with a checks[] array",
    run.status === 200 && Array.isArray(run.json?.checks),
    `→ ${run.status}`,
  );
  if (okRun) {
    const names = new Set((run.json.checks ?? []).map((c) => c.serviceName));
    checks.ok(
      "screen probes the core bindings (database, tesla_database, kv_cache, r2_artifacts, workers_ai)",
      ["database", "tesla_database", "kv_cache", "r2_artifacts", "workers_ai"].every((n) => names.has(n)),
      `got: ${[...names].join(", ")}`,
    );
    checks.ok(
      "overall status is one of healthy|degraded|down",
      ["healthy", "degraded", "down"].includes(run.json?.status),
      `→ ${run.json?.status}`,
    );
    checks.ok(
      "each check carries a status + responseTime shape",
      (run.json.checks ?? []).every(
        (c) => ["healthy", "degraded", "down"].includes(c.status) && "responseTime" in c,
      ),
    );
  }
}

// The history endpoint (existing).
const history = await client.get("/api/health/history?limit=5", { auth: false });
checks.ok("GET /api/health/history → 200 { history:[] }", history.status === 200 && Array.isArray(history.json?.history), `→ ${history.status}`);

// The page itself renders (HTML 200) — only meaningful where the branch is deployed.
const page = await client.get("/health", { auth: false });
if (onProd && page.status === 404) {
  checks.info("PENDING (prod): /health page not deployed yet — expected before merge.");
} else {
  checks.ok("/health page → 200 HTML", page.status === 200 && /<html/i.test(page.text ?? ""), `→ ${page.status}`);
}

checks.finish();
