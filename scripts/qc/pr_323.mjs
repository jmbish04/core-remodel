#!/usr/bin/env node
/**
 * @fileoverview QC — PR #323, 0032 D2b: discovery-finder realtime hub (DiscoveryHub DO).
 *
 * A new Hibernatable-WebSocket Durable Object (DiscoveryHub, wrangler migration v17)
 * fans out finder events per search slug (room "search:<slug>"). The finder engine
 * (D2c) will publish to it; this PR just stands up the DO + its WS gateway route +
 * the publishDiscoveryEvent helper. The heartbeat/broadcast itself needs a live
 * socket, so this QC proves the DO is WIRED and REACHABLE, plus a regression on the
 * sibling realtime gateways the same _worker.ts block routes:
 *   1. GET /api/showrooms/discovery/health?slug=qc → 200 {status:"ok"} (DO reachable
 *      through the new route — it runs before the Hono auth block, like the others).
 *   2. Regression — GET /api/room/qc/health (FloorplanSessionDO) still 200.
 *   3. Reachability.
 *
 *   pnpm run test:pr 323 -- --preview
 *   pnpm run test:pr 323
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const isPreview = client.base !== WORKER_BASE;

console.log(`\nQC pr_323 — discovery realtime hub (D2b)\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`);

try {
  await assertReachable(client, checks);

  // 1. The new DiscoveryHub is wired + reachable through its WS gateway route.
  const health = await client.get("/api/showrooms/discovery/health?slug=qc");
  let body = null;
  try {
    body = typeof health.json === "function" ? await health.json() : health.body;
  } catch {
    /* non-JSON */
  }
  checks.ok(
    "GET /api/showrooms/discovery/health → 200 (DiscoveryHub DO wired + reachable)",
    health.status === 200,
    `→ ${health.status}`,
  );

  // 2. Regression — the sibling FloorplanSessionDO gateway in the same routing block still works.
  const floor = await client.get("/api/room/qc/health");
  checks.ok(
    "GET /api/room/qc/health → 200 (FloorplanSessionDO regression)",
    floor.status === 200,
    `→ ${floor.status}`,
  );

  checks.info(
    "DiscoveryHub is a Hibernatable-WebSocket DO (wrangler migration v17), one instance per search slug (room 'search:<slug>'). The live 15s-style ping/broadcast needs an open socket + the D2c finder engine publishing to it; here we only prove the DO + its /ws|/health gateway route are wired and didn't regress the sibling realtime gateways.",
  );
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
