#!/usr/bin/env node
/**
 * Unit test for drive route sequencing (`services/drive-route-planner.ts`) and
 * California time resolution (`ai/agents/showroom-scout/time.ts`).
 *
 * Pure functions, no network and no bindings — costs nothing to run.
 *
 * Usage:
 *   node scripts/tests/test_route_planner.mjs
 *   pnpm run test:route-planner
 *
 * Plain `node` + node:assert, matching the convention of the sibling scripts.
 * The .ts import works because Node >=22 strips types natively.
 */
import assert from "node:assert/strict";

import { planRoute } from "../../src/backend/services/drive-route-planner.ts";
import { caParts, openDuring, resolveWindow, formatMinute } from "../../src/backend/ai/agents/showroom-scout/time.ts";

let passed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n       ${e.message}`);
    process.exitCode = 1;
  }
}

const H = (h, m = 0) => h * 60 + m;

/** Symmetric travel matrix helper: uniform `mins` between every pair. */
function uniformMatrix(n, mins) {
  return Array.from({ length: n + 1 }, () => Array(n + 1).fill(mins));
}

function stop(id, over = {}) {
  return {
    id,
    name: id,
    dwellMinutes: 45,
    priority: 50,
    openMinute: H(9),
    closeMinute: H(17),
    hoursUnknown: false,
    ...over,
  };
}

console.log("\ndrive-route-planner");

check("sequences all feasible stops and numbers them from 1", () => {
  const stops = [stop("a"), stop("b"), stop("c")];
  const r = planRoute({
    stops,
    travelMinutes: uniformMatrix(3, 15),
    startMinute: H(9),
    endMinute: H(17),
  });
  assert.equal(r.stops.length, 3, "all three should fit");
  assert.deepEqual(
    r.stops.map((s) => s.order),
    [1, 2, 3],
  );
  assert.equal(r.dropped.length, 0);
});

check("early-closing stop is scheduled before a late-closing one", () => {
  // Equal value; only the closing time differs. The 11am closer must go first.
  const stops = [
    stop("late", { closeMinute: H(18) }),
    stop("early", { closeMinute: H(11) }),
  ];
  const r = planRoute({
    stops,
    travelMinutes: uniformMatrix(2, 10),
    startMinute: H(9),
    endMinute: H(18),
  });
  assert.equal(r.stops[0].name, "early", `expected 'early' first, got '${r.stops[0].name}'`);
});

check("never starts a visit later than close - dwell", () => {
  const stops = [stop("a", { closeMinute: H(17) }), stop("b", { closeMinute: H(17) })];
  const r = planRoute({
    stops,
    travelMinutes: uniformMatrix(2, 20),
    startMinute: H(9),
    endMinute: H(17),
  });
  for (const s of r.stops) {
    const begin = s.arriveMinute + s.waitMinutes;
    assert.ok(begin + s.dwellMinutes <= H(17), `${s.name} would run past closing`);
  }
});

check("waits for a stop that has not opened yet", () => {
  const stops = [stop("a", { openMinute: H(10) })];
  const r = planRoute({
    stops,
    travelMinutes: uniformMatrix(1, 10),
    startMinute: H(8),
    endMinute: H(17),
  });
  const s = r.stops[0];
  assert.equal(s.arriveMinute, H(8, 10));
  assert.equal(s.waitMinutes, 110, "arriving 08:10 for a 10:00 open is a 110 min wait");
  assert.equal(s.departMinute, H(10) + 45);
  assert.ok(
    s.warnings.some((w) => w.includes("opens later")),
    "a >=20 min wait should be warned about",
  );
});

check("drops an unreachable stop with a specific reason", () => {
  // Closes at 09:30 but takes 45 min to visit — impossible from a 9:00 start.
  const stops = [stop("shut", { closeMinute: H(9, 30) })];
  const r = planRoute({
    stops,
    travelMinutes: uniformMatrix(1, 20),
    startMinute: H(9),
    endMinute: H(17),
  });
  assert.equal(r.stops.length, 0);
  assert.equal(r.dropped.length, 1);
  assert.match(r.dropped[0].reason, /closes before/);
});

check("treats an unroutable (null) leg as 30 min, not as free travel", () => {
  const travel = uniformMatrix(1, 10);
  travel[0][1] = null;
  const r = planRoute({
    stops: [stop("a")],
    travelMinutes: travel,
    startMinute: H(9),
    endMinute: H(17),
  });
  assert.equal(r.stops[0].arriveMinute, H(9, 30), "null leg must not be treated as 0");
});

check("backfills driveMinutesToNext and leaves the last stop null", () => {
  const r = planRoute({
    stops: [stop("a"), stop("b")],
    travelMinutes: uniformMatrix(2, 12),
    startMinute: H(9),
    endMinute: H(17),
  });
  assert.equal(r.stops[0].driveMinutesToNext, 12);
  assert.equal(r.stops[1].driveMinutesToNext, null);
});

check("hoursUnknown produces a call-ahead warning", () => {
  const r = planRoute({
    stops: [stop("a", { hoursUnknown: true, openMinute: null, closeMinute: null })],
    travelMinutes: uniformMatrix(1, 10),
    startMinute: H(9),
    endMinute: H(17),
  });
  assert.ok(r.stops[0].warnings.some((w) => w.includes("call ahead")));
});

check("prefers the higher-value stop when time is only enough for one", () => {
  const stops = [
    stop("meh", { priority: 10, dwellMinutes: 120 }),
    stop("great", { priority: 95, dwellMinutes: 120 }),
  ];
  const r = planRoute({
    stops,
    travelMinutes: uniformMatrix(2, 15),
    startMinute: H(9),
    endMinute: H(11, 30), // room for exactly one 120-min visit
  });
  assert.equal(r.stops.length, 1);
  assert.equal(r.stops[0].name, "great");
});

check("offers an unrouted stop as a detour with its insertion cost", () => {
  // 3 stops, only 2 fit. The third should come back as a detour option
  // priced by cheapest insertion, not by total drive time.
  const stops = [stop("a", { dwellMinutes: 60 }), stop("b", { dwellMinutes: 60 }), stop("c", { dwellMinutes: 60 })];
  const r = planRoute({
    stops,
    travelMinutes: uniformMatrix(3, 10),
    startMinute: H(9),
    endMinute: H(11, 30), // room for two 60-min visits, not three
  });
  assert.equal(r.stops.length, 2);
  assert.equal(r.detourOptions.length, 1, "the unrouted stop should be offered as a detour");
  const d = r.detourOptions[0];
  // Uniform 10-min matrix: divert 10 + rejoin 10, minus the 10 direct = 10.
  assert.equal(d.extraMinutes, 10);
  assert.equal(d.openAtArrival, "yes");
});

check("detour cost is the insertion delta, not the raw leg time", () => {
  // Origin→1 is 30 min direct. Going via the detour is 20 + 20 = 40.
  // The honest extra cost is 10, not 40.
  const n = 2;
  const t = Array.from({ length: n + 1 }, () => Array(n + 1).fill(60));
  t[0][1] = 30; // origin → routed stop
  t[0][2] = 20; // origin → detour candidate
  t[2][1] = 20; // detour candidate → routed stop
  const r = planRoute({
    stops: [stop("routed", { priority: 99 }), stop("detour", { priority: 1, dwellMinutes: 200 })],
    travelMinutes: t,
    startMinute: H(9),
    endMinute: H(12),
  });
  assert.equal(r.stops.length, 1);
  assert.equal(r.stops[0].name, "routed");
  const d = r.detourOptions.find((x) => x.name === "detour");
  assert.ok(d, "expected a detour option");
  assert.equal(d.extraMinutes, 10, "should be 20+20-30, not 40");
  assert.equal(d.afterOrder, 0, "cheapest insertion is before the first stop");
});

check("flags a detour that would be closed on arrival", () => {
  const stops = [
    stop("a", { dwellMinutes: 60 }),
    stop("shut", { dwellMinutes: 300, openMinute: H(14), closeMinute: H(16) }),
  ];
  const r = planRoute({
    stops,
    travelMinutes: uniformMatrix(2, 10),
    startMinute: H(9),
    endMinute: H(11),
  });
  const d = r.detourOptions.find((x) => x.name === "shut");
  assert.ok(d, "expected the unrouted stop as a detour option");
  assert.equal(d.openAtArrival, "no", "arriving ~9:10 but it opens at 14:00");
});

check("detour options are sorted cheapest-diversion first", () => {
  const n = 3;
  const t = Array.from({ length: n + 1 }, () => Array(n + 1).fill(10));
  // Make stop 3 an expensive diversion, stop 2 a cheap one.
  for (let i = 0; i <= n; i++) {
    t[i][3] = 50;
    t[3][i] = 50;
  }
  const r = planRoute({
    stops: [
      stop("routed", { priority: 99, dwellMinutes: 30 }),
      stop("cheap", { priority: 1, dwellMinutes: 300 }),
      stop("pricey", { priority: 1, dwellMinutes: 300 }),
    ],
    travelMinutes: t,
    startMinute: H(9),
    endMinute: H(10, 30),
  });
  assert.equal(r.detourOptions.length, 2);
  assert.ok(
    r.detourOptions[0].extraMinutes <= r.detourOptions[1].extraMinutes,
    "cheapest diversion must come first",
  );
  assert.equal(r.detourOptions[0].name, "cheap");
});

check("no detour options when every stop made the route", () => {
  const r = planRoute({
    stops: [stop("a"), stop("b")],
    travelMinutes: uniformMatrix(2, 10),
    startMinute: H(9),
    endMinute: H(17),
  });
  assert.equal(r.stops.length, 2);
  assert.equal(r.detourOptions.length, 0);
});

console.log("\nshowroom-scout/time (California)");

check("caParts reads California wall clock, not UTC", () => {
  // 2026-01-15T02:00Z is still Jan 14, 6pm in California (PST, UTC-8).
  const p = caParts(new Date("2026-01-15T02:00:00Z"));
  assert.equal(p.date, "2026-01-14");
  assert.equal(p.day, "wednesday");
  assert.equal(p.hour, 18);
});

check("caParts handles PDT (summer offset)", () => {
  // 2026-07-15T02:00Z is Jul 14, 7pm PDT (UTC-7).
  const p = caParts(new Date("2026-07-15T02:00:00Z"));
  assert.equal(p.date, "2026-07-14");
  assert.equal(p.hour, 19);
});

check("'saturday' said on a Saturday means today, not next week", () => {
  // 2026-07-18 is a Saturday. Noon CA = 19:00Z.
  const w = resolveWindow("saturday", new Date("2026-07-18T19:00:00Z"));
  assert.equal(w.date, "2026-07-18");
  assert.equal(w.day, "saturday");
});

check("a weekday name resolves to the next occurrence", () => {
  // Sat 2026-07-18 → next Tuesday is 2026-07-21.
  const w = resolveWindow("tuesday", new Date("2026-07-18T19:00:00Z"));
  assert.equal(w.date, "2026-07-21");
  assert.equal(w.day, "tuesday");
});

check("'this afternoon' clamps the start to now when already past noon", () => {
  // 15:00 CA on 2026-07-18 = 22:00Z.
  const w = resolveWindow("this afternoon", new Date("2026-07-18T22:00:00Z"));
  assert.equal(w.date, "2026-07-18");
  assert.equal(w.startMinute, H(15), "must not propose a 12:00 start at 3pm");
  assert.equal(w.endMinute, H(17));
});

check("'tomorrow morning' crosses the date boundary correctly", () => {
  const w = resolveWindow("tomorrow morning", new Date("2026-07-18T19:00:00Z"));
  assert.equal(w.date, "2026-07-19");
  assert.equal(w.day, "sunday");
  assert.equal(w.startMinute, H(8));
});

check("REGRESSION: never returns an inverted window (start >= end)", () => {
  // Found live: "saturday morning" asked at 7:20 PM Saturday returned
  // start 7:20 PM / end 12:00 PM. The model silently invented a plausible
  // 7:12 AM rather than reporting the nonsense. Sweep the whole week.
  for (const phrase of ["saturday morning", "this morning", "today", "this afternoon", "monday morning", "tomorrow morning"]) {
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      for (const hourUtc of [0, 4, 8, 12, 16, 20]) {
        const now = new Date(Date.UTC(2026, 6, 12 + dayOffset, hourUtc, 20));
        const w = resolveWindow(phrase, now);
        assert.ok(
          w.startMinute < w.endMinute,
          `inverted for "${phrase}" at ${now.toISOString()}: ${w.startMinute} >= ${w.endMinute}`,
        );
      }
    }
  }
});

check("rolls a passed weekday window to the NEXT week and flags it", () => {
  // 2026-07-18 19:20 CA is Saturday evening; "saturday morning" has passed.
  const w = resolveWindow("saturday morning", new Date("2026-07-19T02:20:00Z"));
  assert.equal(w.date, "2026-07-25", "should roll a full week to the next Saturday");
  assert.equal(w.day, "saturday");
  assert.equal(w.startMinute, H(8));
  assert.equal(w.endMinute, H(12));
  assert.equal(w.rolledForward, true);
  assert.match(w.label, /already passed/);
});

check("rolls a passed same-day window to tomorrow when no weekday was named", () => {
  const w = resolveWindow("this morning", new Date("2026-07-19T02:20:00Z"));
  assert.equal(w.date, "2026-07-19", "no weekday named → roll one day");
  assert.equal(w.rolledForward, true);
  assert.equal(w.startMinute, H(8));
});

check("does not roll forward when the window is still open", () => {
  // 10:00 AM CA on Saturday — the morning is still live.
  const w = resolveWindow("saturday morning", new Date("2026-07-18T17:00:00Z"));
  assert.equal(w.date, "2026-07-18");
  assert.equal(w.rolledForward, false);
  assert.equal(w.startMinute, H(10), "clamped to now, not rolled");
});

check("openDuring reports unknown when there are no hour rows at all", () => {
  assert.equal(openDuring([], "saturday", H(10), H(12)).status, "unknown");
});

check("openDuring reports closed when the day has no row", () => {
  const rows = [{ day: "monday", openHour: 9, openMinute: 0, closeHour: 17, closeMinute: 0 }];
  assert.equal(openDuring(rows, "sunday", H(10), H(12)).status, "closed");
});

check("openDuring counts a partial overlap as open", () => {
  // Closes at 16:00; a 15:00–18:00 window still leaves a usable hour.
  const rows = [{ day: "saturday", openHour: 10, openMinute: 0, closeHour: 16, closeMinute: 0 }];
  const r = openDuring(rows, "saturday", H(15), H(18));
  assert.equal(r.status, "open");
  assert.equal(r.closesAt, H(16));
});

check("formatMinute renders 12-hour California time", () => {
  assert.equal(formatMinute(H(9, 5)), "9:05 AM");
  assert.equal(formatMinute(H(12)), "12:00 PM");
  assert.equal(formatMinute(H(0)), "12:00 AM");
  assert.equal(formatMinute(H(13, 30)), "1:30 PM");
});

console.log(`\n${passed} passed${process.exitCode ? " (with failures)" : ""}\n`);
