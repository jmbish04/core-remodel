#!/usr/bin/env node
/**
 * @fileoverview QC — PR #318, 0032 N1: multi-waypoint Tesla nav + NavigateTeslaButton.
 *
 * Sending a real route needs Tessie creds + a live car, so this proves the SURFACE
 * is wired (the actual nav is exercised in-car):
 *   1. NEW POST /api/tesla/navigate-drive exists (admin-gated → 401 without a cookie,
 *      or 400 on a bad body; a 404 would mean the route is missing).
 *   2. NEW MCP send_drive_to_tesla is in the /api/mcp-docs catalog.
 *   3. Regression — POST /api/tesla/navigate (single dest) + GET /api/tesla/status
 *      still respond (the nav service refactor is additive).
 *
 *   pnpm run test:pr 318 -- --preview
 *   pnpm run test:pr 318
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const isPreview = client.base !== WORKER_BASE;

console.log(`\nQC pr_318 — multi-waypoint Tesla nav (N1)\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`);

try {
  await assertReachable(client, checks);

  // 1. NEW navigate-drive route exists (not 404).
  const nav = await client.post("/api/tesla/navigate-drive", {});
  if (nav.status === 404 && !isPreview) {
    checks.info("POST /api/tesla/navigate-drive → 404 on prod: pending merge/deploy (expected pre-merge).");
  } else {
    checks.ok(
      "POST /api/tesla/navigate-drive → route wired (401 gated / 400 bad-body, not 404)",
      nav.status === 401 || nav.status === 400,
      `→ ${nav.status}`,
    );
  }

  // 2. NEW MCP tool in the catalog.
  const docs = await client.get("/api/mcp-docs");
  const names = new Set(Array.isArray(docs.json?.tools) ? docs.json.tools.map((t) => t?.name) : []);
  if (docs.status === 200 && names.size > 0) {
    checks.ok(
      "MCP catalog exposes send_drive_to_tesla",
      names.has("send_drive_to_tesla"),
      names.has("send_drive_to_tesla") ? "" : "not present (pending merge/deploy)",
    );
  } else {
    checks.info(`GET /api/mcp-docs → ${docs.status} (catalog not reachable; skipped tool-presence check).`);
  }

  // 3. Regression — the existing single-destination route + status.
  const single = await client.post("/api/tesla/navigate", {});
  checks.ok(
    "POST /api/tesla/navigate → still wired (401/400/502, not 404)",
    [400, 401, 502].includes(single.status),
    `→ ${single.status}`,
  );
  const status = await client.get("/api/tesla/status");
  checks.ok("GET /api/tesla/status → responds", status.status === 200 || status.status === 401, `→ ${status.status}`);

  checks.info("Multi-waypoint send builds a Google Maps directions share (sendMultiWaypointNavigation); the actual in-car route is exercised on a live car, not here.");
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
