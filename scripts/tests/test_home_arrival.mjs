#!/usr/bin/env node
/**
 * Unit test for the "you're home, the drive is over" rule
 * (`services/drive-home-arrival-rules.ts`).
 *
 * Pure functions, no network and no bindings — costs nothing to run.
 *
 * Usage:
 *   node scripts/tests/test_home_arrival.mjs
 *   pnpm run test:home-arrival
 *
 * Plain `node` + node:assert, matching the sibling scripts. The .ts import works
 * because Node >=22 strips types natively.
 */
import assert from "node:assert/strict";

import {
  distanceMeters,
  homeArrivalReason,
  localMinutesInLA,
  HOME_ARRIVAL_AFTER_MINUTES,
  HOME_RADIUS_M,
} from "../../src/backend/services/drive-home-arrival-rules.ts";

let passed = 0;
const check = (label, fn) => {
  fn();
  passed++;
  console.log(`  ✓ ${label}`);
};

// 126 Colby St, San Francisco — used only as a fixed reference point here.
const HOME = { lat: 37.7371, lng: -122.4064 };

console.log("\ndistanceMeters\n");

check("zero distance to itself", () => {
  assert.equal(Math.round(distanceMeters(HOME.lat, HOME.lng, HOME.lat, HOME.lng)), 0);
});

check("~111m per 0.001° of latitude", () => {
  const d = distanceMeters(HOME.lat, HOME.lng, HOME.lat + 0.001, HOME.lng);
  assert.ok(d > 105 && d < 116, `got ${d}`);
});

check("a next-door fix is inside the home radius", () => {
  const d = distanceMeters(HOME.lat, HOME.lng, HOME.lat + 0.0005, HOME.lng);
  assert.ok(d <= HOME_RADIUS_M, `got ${d}`);
});

check("a showroom across town is not", () => {
  // Berkeley — ~15km away.
  const d = distanceMeters(HOME.lat, HOME.lng, 37.8715, -122.273);
  assert.ok(d > 10_000, `got ${d}`);
});

console.log("\nlocalMinutesInLA (must be a real timezone conversion, not an offset)\n");

check("16:00 PDT (summer, UTC-7) reads as 960", () => {
  assert.equal(localMinutesInLA(new Date("2026-07-21T23:00:00Z")), 16 * 60);
});

check("16:00 PST (winter, UTC-8) also reads as 960", () => {
  assert.equal(localMinutesInLA(new Date("2026-01-21T24:00:00Z")), 16 * 60);
});

check("midnight local is 0, not 1440", () => {
  assert.equal(localMinutesInLA(new Date("2026-07-21T07:00:00Z")), 0);
});

console.log("\nhomeArrivalReason\n");

const AFTER = new Date("2026-07-21T23:00:00Z"); // 16:00 PDT
const BEFORE = new Date("2026-07-21T18:00:00Z"); // 11:00 PDT
const base = { hasActiveDrive: true, stopped: true, at: AFTER, distanceM: 10 };

check("parked at home ends the drive", () => {
  assert.equal(homeArrivalReason(base), "ended");
});

check("no active drive short-circuits first", () => {
  assert.equal(homeArrivalReason({ ...base, hasActiveDrive: false }), "no-active-drive");
});

check("driving PAST the house does not end it (must be parked)", () => {
  assert.equal(homeArrivalReason({ ...base, stopped: false }), "not-stopped");
});

check("parked at home at lunchtime NOW ends it (no wall-clock cutoff)", () => {
  assert.equal(homeArrivalReason({ ...base, at: BEFORE }), "ended");
});

check("parked somewhere else does not end it", () => {
  assert.equal(homeArrivalReason({ ...base, distanceM: 4_000 }), "not-home");
});

check("exactly on the radius still counts as home", () => {
  assert.equal(homeArrivalReason({ ...base, distanceM: HOME_RADIUS_M }), "ended");
});

check("one metre past the radius does not", () => {
  assert.equal(homeArrivalReason({ ...base, distanceM: HOME_RADIUS_M + 1 }), "not-home");
});

check("an unknown home position never reads as 'home'", () => {
  assert.equal(homeArrivalReason({ ...base, distanceM: null }), "home-unconfigured");
});

check("time of day no longer matters — parked at home ends it at any hour", () => {
  // 15:30 PDT and one minute earlier both end now (no wall-clock cutoff).
  assert.equal(homeArrivalReason({ ...base, at: new Date("2026-07-21T22:30:00Z") }), "ended");
  assert.equal(homeArrivalReason({ ...base, at: new Date("2026-07-21T22:29:00Z") }), "ended");
  // 3am, still parked at home → ended.
  assert.equal(homeArrivalReason({ ...base, at: new Date("2026-07-21T10:00:00Z") }), "ended");
});

check("the rule applies seven days a week (Sunday)", () => {
  const sunday = new Date("2026-07-19T23:00:00Z"); // Sun 16:00 PDT
  assert.equal(sunday.getUTCDay(), 0);
  assert.equal(homeArrivalReason({ ...base, at: sunday }), "ended");
});

console.log(`\n${passed} passed\n`);
