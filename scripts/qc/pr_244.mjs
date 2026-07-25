#!/usr/bin/env node
/**
 * QC for PR #244 — drive-list map render + stop-card action fixes (PR-A).
 * Run: node scripts/qc/pr_244.mjs --preview   (or bare for prod)
 *
 * The only backend change is `GET /api/drive-lists/:slug` backfilling each
 * stop's missing lat/lng from its linked showroom, so the MapLibre route map
 * (which renders only when >=1 shown stop has coords) stops falling back to the
 * empty pin icon. #3/#6 are pure CSS in the same bundle.
 *
 * Regression guards (pass on prod AND preview): the list + detail endpoints keep
 * their 200 + shape. New behavior (coord backfill) is hard-asserted only off
 * prod; on prod it is reported as pending-merge, per the QC policy.
 */
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const IS_PROD = BASE.replace(/\/$/, "") === "https://core-remodel.hacolby.workers.dev";
const c = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
console.log(`QC pr_244 (drive map + card actions) against ${BASE}\n`);

const list = await c.get("/api/drive-lists");
check("GET /api/drive-lists 200", list.status === 200, `status=${list.status}`);
const drives = list.json?.driveLists ?? [];
check("list returns a driveLists array", Array.isArray(drives), `count=${drives.length}`);

// Walk every drive's detail endpoint: regression on shape, and measure how many
// drives will render a map (>=1 shown stop with coords) vs how many linked stops
// still carry coords after the backfill.
let detailOk = 0;
let drivesMappable = 0;
let linkedStops = 0;
let linkedStopsWithCoords = 0;
let drivesWithLinkedButNoMap = 0;

for (const d of drives) {
  const res = await c.get(`/api/drive-lists/${encodeURIComponent(d.slug)}`);
  if (res.status !== 200 || !Array.isArray(res.json?.stops)) continue;
  detailOk += 1;
  const stops = res.json.stops;
  const withCoords = stops.filter((s) => s.latitude != null && s.longitude != null);
  const linked = stops.filter((s) => s.showroomStoreId != null);
  linkedStops += linked.length;
  linkedStopsWithCoords += linked.filter((s) => s.latitude != null && s.longitude != null).length;
  if (withCoords.length > 0) drivesMappable += 1;
  // A drive that links showrooms yet renders no map is the exact bug this fixes.
  if (linked.length > 0 && withCoords.length === 0) drivesWithLinkedButNoMap += 1;
}

check(
  "every drive's detail endpoint returns 200 + stops[]",
  detailOk === drives.length,
  `${detailOk}/${drives.length}`,
);
info(`drives that render a map: ${drivesMappable}/${drives.length}`);
info(`linked stops with coords: ${linkedStopsWithCoords}/${linkedStops}`);

const coordFillHolds = drivesWithLinkedButNoMap === 0;
if (IS_PROD) {
  info(
    `coord-backfill assertion skipped on prod (pending merge/deploy) — ` +
      `${drivesWithLinkedButNoMap} drive(s) link showrooms but show no map here`,
  );
} else {
  check(
    "no drive links showrooms yet renders an empty map (coord backfill works)",
    coordFillHolds,
    `offenders=${drivesWithLinkedButNoMap}`,
  );
}

summary();
