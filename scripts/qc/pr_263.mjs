#!/usr/bin/env node
/**
 * @fileoverview QC — PR #263, live parsed-event ticker + opt-in auto-nav + drive-scoped matching.
 *
 * Read-only shape checks against the deployed worker:
 *   • GET /api/tesla/stream/events → { count, events[] } with each event pre-parsed.
 *   • POST /api/tesla/stream/control { autoNavigate } round-trips + is reflected back.
 *
 * The matcher-scoping fix (is_active vs status) is exercised by live telemetry /
 * the poller, so it's asserted by inspection + the build, not this HTTP harness.
 *
 *   pnpm run test:pr 263 -- --preview
 *   pnpm run test:pr 263
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(`\nQC pr_263 — telemetry ticker + control\n  target: ${resolveBase()}\n`);

await assertReachable(client, checks);

try {
  const res = await client.get("/api/tesla/stream/events?limit=5");
  if (onProd && res.status === 404) {
    checks.info("PENDING: /api/tesla/stream/events not on prod yet (route 404; needs merge+deploy)");
  } else {
    checks.ok(
      "GET /api/tesla/stream/events → 200 with { count, events[] }",
      res.status === 200 && typeof res.json?.count === "number" && Array.isArray(res.json?.events),
      `→ ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`,
    );
    const rows = res.json?.events ?? [];
    if (rows.length > 0) {
      checks.ok(
        "each parsed event carries a display `text` + `id`",
        rows.every((r) => typeof r.text === "string" && typeof r.id === "number"),
        `first=${JSON.stringify(rows[0])}`,
      );
    } else {
      checks.info("no telemetry frames yet (expected until a live in-window drive streams)");
    }
  }

  // Auto-nav toggle round-trips and is reflected back. Restore to OFF (the safe default).
  const ctrl = await client.post("/api/tesla/stream/control", { autoNavigate: false });
  if (onProd && ctrl.status === 404) {
    checks.info("PENDING: /api/tesla/stream/control not on prod yet");
  } else {
    checks.ok(
      "POST /stream/control { autoNavigate:false } → 200 and reflects autoNavigate=false",
      ctrl.status === 200 && ctrl.json?.control?.autoNavigate === false,
      `→ ${ctrl.status} ${JSON.stringify(ctrl.json?.control).slice(0, 160)}`,
    );
  }
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
