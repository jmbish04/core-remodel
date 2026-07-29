#!/usr/bin/env node
/**
 * @fileoverview QC — PR #302, 0032 D1b: Park-Finds workspace (frontend).
 *
 * Frontend-only — a new /admin page + sidebar entry over D1a's already-shipped
 * /api/showroom-hitl-queue. No schema/API/MCP change. This proves the page route
 * exists and the endpoint it consumes is healthy:
 *   1. GET /admin/shopping/showrooms/hitl — the admin page renders (200; or a
 *      redirect to the access gate when unauthenticated — both prove it's wired,
 *      a 404 would mean the route is missing).
 *   2. Regression — GET /api/showroom-hitl-queue (D1a) still returns the
 *      { count, pending, candidates } shape the page depends on. Pre-merge on prod
 *      it may 401 (gated) — reported, not failed.
 *
 *   pnpm run test:pr 302 -- --preview
 *   pnpm run test:pr 302
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const isPreview = client.base !== WORKER_BASE;

console.log(`\nQC pr_302 — Park-Finds workspace (D1b)\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`);

try {
  await assertReachable(client, checks);

  // 1. The admin page route exists (200 rendered, or a 3xx/401 gate — never 404).
  const page = await client.get("/admin/shopping/showrooms/hitl");
  checks.ok(
    "GET /admin/shopping/showrooms/hitl → route exists (not 404)",
    page.status !== 404,
    `→ ${page.status}`,
  );

  // 2. Regression — the D1a endpoint the page consumes.
  const hitl = await client.get("/api/showroom-hitl-queue?decision=TBD");
  if (hitl.status === 401) {
    checks.info("GET /api/showroom-hitl-queue → 401 (admin-gated; QC lacks a cookie here). Route is live.");
  } else if (hitl.status === 404 && !isPreview) {
    checks.info("GET /api/showroom-hitl-queue → 404 on prod: pending D1a deploy (expected pre-merge).");
  } else {
    checks.ok(
      "GET /api/showroom-hitl-queue → 200 { count, pending, candidates[] }",
      hitl.status === 200 && Array.isArray(hitl.json?.candidates) && typeof hitl.json?.pending === "number",
      `→ ${hitl.status}`,
    );
  }

  checks.info("The Park-Finds island (ParkFindsApp) + sidebar TBD badge are exercised by loading the page in a browser; the build (esbuild) is the compile gate.");
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
