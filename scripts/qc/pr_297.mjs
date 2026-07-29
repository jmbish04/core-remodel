#!/usr/bin/env node
/**
 * @fileoverview QC — PR #297, 0032 L1 park/dwell detector + park_sessions.
 *
 * The detector fires on a real fix STREAM (a poll-only drive parking, then driving
 * away), which can't be synthesized from a QC script — so this proves the wiring
 * is safe, not the dwell math (that's unit-reasoned in the detector + exercised on
 * a live drive):
 *   1. Regression — tesla status + visit-logs (the detector stages into this) are
 *      healthy; POST /api/tesla/poll still self-gates cleanly (the detector call is
 *      additive to the poll path, so a broken wire would surface here).
 *   2. The park_sessions migration (0149) is verified by the deploy's migrate:remote
 *      step — a failed CREATE TABLE fails the deploy. Reported, not re-run here.
 *
 *   pnpm run test:pr 297 -- --preview
 *   pnpm run test:pr 297
 */
import { assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";

const client = createClient();
const checks = createChecks();

console.log(`\nQC pr_297 — park/dwell detector (L1)\n  target: ${resolveBase()}\n`);

try {
  await assertReachable(client, checks);

  const status = await client.get("/api/tesla/status");
  checks.ok("GET /api/tesla/status → 200 (integration)", status.status === 200, `→ ${status.status}`);

  const visits = await client.get("/api/showroom-visit-logs?status=pending&limit=1");
  checks.ok(
    "GET /api/showroom-visit-logs → 200 (detector stages soft arrivals into this)",
    visits.status === 200 && Array.isArray(visits.json?.visits),
    `→ ${visits.status}`,
  );

  // The poller now feeds the detector (additive). It self-gates: with no active
  // drive it returns { polled:false, reason:"no-active-drive" } WITHOUT reaching
  // Tessie or the detector — so this is a safe regression that the wiring didn't
  // break the poll path. (A real park/drive-away is exercised on a live drive.)
  const poll = await client.post("/api/tesla/poll", {});
  checks.ok(
    "POST /api/tesla/poll → 200 (poll path intact after detector wiring)",
    poll.status === 200 && typeof poll.json?.reason === "string",
    `→ ${poll.status} ${JSON.stringify(poll.json ?? {}).slice(0, 120)}`,
  );

  checks.info("park_sessions table (migration 0149) verified by the deploy's migrate:remote step.");
  checks.info("PARK/DRIVE-AWAY dwell detection is exercised by a live poll-only drive (not synthesizable here).");
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
