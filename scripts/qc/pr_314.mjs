#!/usr/bin/env node
/**
 * @fileoverview QC — PR #314, 0032 D1: Gemini relevance pass in the proximity scan.
 *
 * Backend-only, no schema / no new endpoint. The relevance pass is internal to
 * `proximityScan` and only fires on a real PARK at an unregistered place, so it
 * can't be synthesized here. This proves the surface it feeds is intact:
 *   1. Regression — GET /api/showroom-hitl-queue (D1a) still returns the
 *      { count, pending, candidates } shape the scan writes into. On prod before
 *      merge it may 401 (gated) — reported, not failed.
 *   2. The scan now stamps each candidate's description/categoryGuess from Gemini
 *      (feature "proximity_scan_relevance" in gemini_usage_log) with a $0
 *      Places-heuristic fallback on any model failure; exercised on a live drive.
 *
 *   pnpm run test:pr 314 -- --preview
 *   pnpm run test:pr 314
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const isPreview = client.base !== WORKER_BASE;

console.log(`\nQC pr_314 — proximity-scan Gemini relevance pass\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`);

try {
  await assertReachable(client, checks);

  const hitl = await client.get("/api/showroom-hitl-queue?decision=TBD");
  if (hitl.status === 401) {
    checks.info("GET /api/showroom-hitl-queue → 401 (admin-gated; QC lacks a cookie here). Route is live.");
  } else {
    checks.ok(
      "GET /api/showroom-hitl-queue → 200 { count, pending, candidates[] } (scan sink intact)",
      hitl.status === 200 && Array.isArray(hitl.json?.candidates) && typeof hitl.json?.pending === "number",
      `→ ${hitl.status}`,
    );
  }

  checks.info("Decision D0 is now Places includedTypes (coarse) + a Gemini relevance verdict (precision); the AI category/one-liner land on the Park-Finds card.");
  checks.info("Gemini failure is fail-safe: null verdict → deterministic Places heuristic, so a model outage never blocks a park-find. Usage logs under feature=proximity_scan_relevance.");
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
