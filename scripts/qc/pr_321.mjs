#!/usr/bin/env node
/**
 * @fileoverview QC — PR #321, 0032 D2a: discovery-search schema foundation.
 *
 * This PR is schema-only: 3 new tables (showroom_search / _revision / _result) and
 * 6 additive columns on showroom_exclusions (address×5 + category). There is NO new
 * endpoint yet — the finder engine that reads these tables is D2c. So this QC is a
 * REGRESSION guard proving the additive migration (0163) didn't break the live
 * surface that already touches showroom_exclusions:
 *   1. GET /api/showroom-hitl-queue responds (D1a's park-find sink; its decide path
 *      writes showroom_exclusions — a broken ALTER would surface as a 500 here).
 *   2. GET /api/showrooms (directory) still responds.
 *   3. Reachability.
 * The new tables' existence is verified by migrate:remote's confirmation (the
 * migration is CREATE TABLE + additive ADD COLUMN only) and exercised once D2c's
 * /api/showroom-searches endpoints land.
 *
 *   pnpm run test:pr 321 -- --preview
 *   pnpm run test:pr 321
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const isPreview = client.base !== WORKER_BASE;

console.log(`\nQC pr_321 — discovery-search schema (D2a)\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`);

try {
  await assertReachable(client, checks);

  // 1. Regression — the park-find queue reads/writes showroom_exclusions; a broken
  //    additive ALTER would 500 it. Admin-gated → 200 (authed) or 401 (no cookie),
  //    never 500.
  const hitl = await client.get("/api/showroom-hitl-queue");
  checks.ok(
    "GET /api/showroom-hitl-queue → responds (exclusions ALTER didn't break the sink)",
    hitl.status === 200 || hitl.status === 401,
    `→ ${hitl.status}`,
  );

  // 2. Regression — the showroom directory still lists.
  const showrooms = await client.get("/api/showrooms");
  checks.ok(
    "GET /api/showrooms → responds",
    showrooms.status === 200 || showrooms.status === 401,
    `→ ${showrooms.status}`,
  );

  checks.info(
    "Schema-only PR: showroom_search/_revision/_result + showroom_exclusions address×5/category (migration 0163). New tables get their own QC once the D2c finder endpoints (/api/showroom-searches) land; here we only guard that the additive migration left the live exclusions-touching surface intact.",
  );
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
