#!/usr/bin/env node
/**
 * QC for PR #262 — permit-address geofence (500yd + parked, any hour).
 * Run: node scripts/qc/pr_262.mjs --preview   (or bare for prod)
 *
 * The rule itself is covered by scripts/tests/test_home_arrival.mjs (17 pass).
 * This asserts the deployed /home-location advertises the new geometry. On prod
 * (pre-deploy) it still reads the old 150m — reported, not failed.
 */
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const IS_PROD = BASE.replace(/\/$/, "") === "https://core-remodel.hacolby.workers.dev";
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_262 (permit geofence) against ${BASE}\n`);

const res = await c.get("/api/drive-lists/home-location");
check("GET /home-location 200", res.status === 200, `status=${res.status}`);
info(`radiusM=${res.json?.radiusM}, afterLocalMinutes=${res.json?.afterLocalMinutes}, requiresParked=${res.json?.requiresParked}`);

if (IS_PROD) {
  info("new geometry (457m / no cutoff) asserted only off prod until this deploys");
} else {
  check("radius widened to 500yd (457m)", res.json?.radiusM === 457, `radiusM=${res.json?.radiusM}`);
  check("wall-clock cutoff removed", res.json?.afterLocalMinutes === null, `afterLocalMinutes=${res.json?.afterLocalMinutes}`);
  check("parked requirement advertised", res.json?.requiresParked === true, `requiresParked=${res.json?.requiresParked}`);
}
summary();
