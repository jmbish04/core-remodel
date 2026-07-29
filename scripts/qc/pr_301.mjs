#!/usr/bin/env node
/**
 * @fileoverview QC — PR #301, 0032 D1a: proximity scan + Park-Finds HITL (backend).
 *
 * The proximity scan fires on a real PARK at an unregistered place (a live drive
 * parking near a store not in the directory) — that can't be synthesized here. So
 * this proves the SURFACE is live and safe, not the scan's Places call:
 *   1. NEW read surface — GET /api/showroom-hitl-queue (+ ?decision=TBD) returns the
 *      { count, pending, candidates } shape. On prod BEFORE this merges the route is
 *      absent → reported "pending merge/deploy", not a hard failure.
 *   2. NEW MCP tools — list_park_finds + decide_park_find are in the /api/mcp-docs
 *      catalog (both surfaces exposed).
 *   3. Regression — visit-logs + tesla status still healthy (the scan stages a
 *      discovery soft arrival into showroom_visit_log; a broken wire shows here).
 *   4. Schema (migration 0153) is verified by the deploy's migrate:remote step — a
 *      failed CREATE TABLE fails the deploy. Reported, not re-run here.
 *
 *   pnpm run test:pr 301 -- --preview     # your branch's preview worker
 *   pnpm run test:pr 301                  # production (regression + pending-merge notes)
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const isPreview = client.base !== WORKER_BASE;

console.log(`\nQC pr_301 — proximity scan + Park-Finds HITL (D1a)\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`);

try {
  await assertReachable(client, checks);

  // 1. NEW HITL read surface.
  const hitl = await client.get("/api/showroom-hitl-queue");
  if (hitl.status === 404 && !isPreview) {
    checks.info("GET /api/showroom-hitl-queue → 404 on prod: pending merge/deploy (expected pre-merge).");
  } else {
    checks.ok(
      "GET /api/showroom-hitl-queue → 200 { count, pending, candidates[] }",
      hitl.status === 200 &&
        typeof hitl.json?.count === "number" &&
        typeof hitl.json?.pending === "number" &&
        Array.isArray(hitl.json?.candidates),
      `→ ${hitl.status} ${JSON.stringify(hitl.json ?? {}).slice(0, 120)}`,
    );

    const tbd = await client.get("/api/showroom-hitl-queue?decision=TBD");
    checks.ok(
      "GET /api/showroom-hitl-queue?decision=TBD → 200 (inbox filter)",
      tbd.status === 200 && Array.isArray(tbd.json?.candidates),
      `→ ${tbd.status}`,
    );

    // Decide on a non-existent id → 404 (validates the decide route without a real candidate).
    const decide = await client.post("/api/showroom-hitl-queue/999999999/decide", {
      decision: "DO_NOT_PROCESS",
    });
    checks.ok(
      "POST /api/showroom-hitl-queue/:id/decide (missing id) → 404 (route wired, guards the id)",
      decide.status === 404,
      `→ ${decide.status}`,
    );
  }

  // 2. NEW MCP tools in the catalog.
  const docs = await client.get("/api/mcp-docs");
  const names = new Set(
    Array.isArray(docs.json?.tools) ? docs.json.tools.map((t) => t?.name) : [],
  );
  if (docs.status === 200 && names.size > 0) {
    checks.ok(
      "MCP catalog exposes list_park_finds + decide_park_find",
      names.has("list_park_finds") && names.has("decide_park_find"),
      names.has("list_park_finds") || names.has("decide_park_find")
        ? "one present — pending merge for the other?"
        : "neither present (pending merge/deploy)",
    );
  } else {
    checks.info(`GET /api/mcp-docs → ${docs.status} (catalog not reachable; skipped tool-presence check).`);
  }

  // 3. Regression — the surfaces the scan stages into.
  const visits = await client.get("/api/showroom-visit-logs?status=pending&limit=1");
  checks.ok(
    "GET /api/showroom-visit-logs → 200 (scan stages discovery soft arrivals here)",
    visits.status === 200 && Array.isArray(visits.json?.visits),
    `→ ${visits.status}`,
  );
  const status = await client.get("/api/tesla/status");
  checks.ok("GET /api/tesla/status → 200 (integration healthy)", status.status === 200, `→ ${status.status}`);

  checks.info("Migration 0153 (hitl_queue + exclusions + column adds) verified by the deploy's migrate:remote step.");
  checks.info("Live proximity scan (Places call on a real park at an unregistered place) is exercised on a drive, not here.");
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
