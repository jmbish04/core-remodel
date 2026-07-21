#!/usr/bin/env node
/**
 * @fileoverview QC — PR #181, DO alarm circuit breaker (0023 workstream A).
 *
 * Exercises the new admin circuit-breaker surface and guards the existing
 * integrations-usage endpoint against regression. Uses the shared helpers so the
 * harness behaves identically to every other PR's QC.
 *
 *   pnpm run test:pr 181 -- --preview   # this branch's preview worker (new surface)
 *   pnpm run test:pr 181                 # production — regression guard; the new
 *                                        # endpoints report "pending" until merge+deploy
 *
 * The breaker endpoints don't exist on prod until this merges and `pnpm run deploy`
 * runs, so on the production target a 404 for them is reported as PENDING (not a
 * hard failure), per the QC-against-both rule in AGENTS.md.
 */
import { createClient, createChecks, assertReachable, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(`\nQC pr_181 — DO circuit breaker\n  target: ${resolveBase()}${onProd ? " (PROD — new endpoints report PENDING until merge+deploy)" : ""}\n`);

await assertReachable(client, checks);

// ── Regression: the existing integrations-usage endpoint still works ──────────
const usage = await client.get("/api/admin/integrations/usage");
checks.ok("GET /api/admin/integrations/usage → 200 (regression)", usage.status === 200, `→ ${usage.status}`);

// ── New surface: circuit-breaker status + clear ──────────────────────────────
const status = await client.get("/api/admin/integrations/circuit-breaker");

if (onProd && status.status === 404) {
  checks.info("PENDING (prod): /api/admin/integrations/circuit-breaker not deployed yet — expected before merge.");
} else {
  const okStatus = checks.ok(
    "GET /circuit-breaker → 200 with a boolean `tripped`",
    status.status === 200 && typeof status.json?.tripped === "boolean",
    `→ ${status.status} ${JSON.stringify(status.json)}`,
  );

  if (okStatus) {
    // Clearing is idempotent and safe to run — it only sets tripped:false.
    const clear = await client.post("/api/admin/integrations/circuit-breaker/clear", {});
    checks.ok(
      "POST /circuit-breaker/clear → 200 { ok:true }",
      clear.status === 200 && clear.json?.ok === true,
      `→ ${clear.status} ${JSON.stringify(clear.json)}`,
    );

    const after = await client.get("/api/admin/integrations/circuit-breaker");
    checks.ok(
      "breaker reads healthy (tripped:false) after clear",
      after.status === 200 && after.json?.tripped === false,
      `→ ${JSON.stringify(after.json)}`,
    );
  }

  // Auth guard: the secret-gated admin routes must reject an unauthenticated call.
  const unauth = await client.get("/api/admin/integrations/circuit-breaker", { auth: false });
  checks.ok(
    "GET /circuit-breaker without auth → 401/403",
    unauth.status === 401 || unauth.status === 403,
    `→ ${unauth.status}`,
  );
}

checks.finish();
