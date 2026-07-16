#!/usr/bin/env node
/**
 * @fileoverview Tesla / Tessie integration smoke test — drive-down-the-block edition.
 *
 * Exercises everything the Tesla integration actually ships today (#133/#136/#137):
 *   - GET  /api/tesla/status    is Tessie configured (do the secrets resolve)?
 *   - GET  /api/drive-lists     which drive is active, which stops have coords
 *   - POST /api/tesla/navigate  push a destination to the car  ← commands the car
 *   - POST /api/tesla/webhook   park event → auto-visit + auto-advance
 *   - POST /api/tesla/telemetry Fleet Telemetry frame → TESLA_DB
 *
 * AUTH — no browser needed. `/status` + `/navigate` are admin-gated by the
 * `remodel_access` cookie, whose value is literally SHA-256(WORKER_API_KEY)
 * (see src/backend/utils/access.ts). `/webhook` + `/telemetry` take the same
 * WORKER_API_KEY as a shared secret header. So one env var authenticates
 * everything.
 *
 * USAGE
 *   export WORKER_API_KEY='…'                 # required
 *   export TESLA_HOST='https://core-remodel.hacolby.workers.dev'   # optional
 *
 *   node scripts/tesla-smoke.mjs preflight            # SAFE: read-only. run first.
 *   node scripts/tesla-smoke.mjs navigate <slug> <stopId>   # COMMANDS THE CAR
 *   node scripts/tesla-smoke.mjs simulate-park <slug> <stopId>  # WRITES: marks visited
 *   node scripts/tesla-smoke.mjs telemetry            # WRITES: one fake frame
 *   node scripts/tesla-smoke.mjs watch <slug>         # SAFE: live drive state
 *   node scripts/tesla-smoke.mjs reset <slug> <stopId>  # WRITES: un-visit a stop
 *
 * Commands that command the car or write data ask for confirmation unless -y.
 */

import { createInterface } from "node:readline/promises";
import { createHash } from "node:crypto";

const HOST = (process.env.TESLA_HOST || "https://core-remodel.hacolby.workers.dev").replace(/\/$/, "");
const KEY = process.env.WORKER_API_KEY || "";
const YES = process.argv.includes("-y");

if (!KEY) {
  console.error("✗ WORKER_API_KEY is not set.\n  export WORKER_API_KEY='…' (same value as the Secrets Store secret)");
  process.exit(1);
}

/** The admin cookie IS sha256(WORKER_API_KEY) — see utils/access.ts hashString(). */
const ADMIN_COOKIE = `remodel_access=${createHash("sha256").update(KEY).digest("hex")}`;

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => console.log(`  \x1b[2m·\x1b[0m ${m}`);
const head = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

async function api(path, { method = "GET", body, secret = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (secret) headers["X-Webhook-Secret"] = KEY;
  else headers.Cookie = ADMIN_COOKIE;
  const res = await fetch(`${HOST}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { _raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

async function confirm(msg) {
  if (YES) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(`\n\x1b[33m${msg}\x1b[0m [y/N] `);
  rl.close();
  return a.trim().toLowerCase() === "y";
}

/** Active drive + its stops, with resolved coords. */
async function activeDrive() {
  const { json } = await api("/api/drive-lists");
  const drives = json?.driveLists ?? [];
  const active = drives.find((d) => d.status === "active");
  if (!active) return { active: null, drives };
  const detail = await api(`/api/drive-lists/${active.slug}`);
  return { active, detail: detail.json, drives };
}

// ── preflight ──────────────────────────────────────────────────────────────
async function preflight() {
  head("1. Auth + Tessie config");
  const s = await api("/api/tesla/status");
  if (s.status === 401) return bad("admin auth FAILED — WORKER_API_KEY doesn't match prod's secret."), false;
  if (s.status !== 200) return bad(`/api/tesla/status → ${s.status} ${JSON.stringify(s.json)}`), false;
  ok(`admin auth works (cookie = sha256(WORKER_API_KEY))`);
  if (s.json.configured) ok("Tessie configured → TESSIE_API_TOKEN + TESLA_BETSY_VIN both resolve");
  else {
    bad("Tessie NOT configured — /navigate will 502 and the Tesla button is hidden.");
    info("Check the Secrets Store has TESSIE_API_TOKEN and TESLA_BETSY_VIN set (not just bound).");
    return false;
  }

  head("2. Active drive list");
  const { active, detail, drives } = await activeDrive();
  if (!active) {
    bad(`no drive has status=active (${drives.length} drive(s) total)`);
    info("Open /admin/shopping/drives and make one active — the whole GPS pipeline is gated on it.");
    return false;
  }
  ok(`active drive: "${active.title}" (${active.slug}) — ${active.visitedCount}/${active.stopCount} visited`);

  const stops = detail?.stops ?? [];
  const withCoords = stops.filter((s) => s.latitude != null && s.longitude != null);
  const unvisited = withCoords.filter((s) => !s.visited);
  if (withCoords.length === 0) {
    bad("no stop on this drive has lat/lng — geo-matching cannot work.");
    info("The park matcher needs coords on the stop or its linked showroom.");
    return false;
  }
  ok(`${withCoords.length}/${stops.length} stops have coords; ${unvisited.length} unvisited`);

  head("3. Targets you can test with");
  for (const s of unvisited.slice(0, 5)) {
    info(`stopId=${s.id}  ${s.name}  (${s.latitude}, ${s.longitude})${s.address ? ` — ${s.address}` : ""}`);
  }
  console.log(`
\x1b[1mNext:\x1b[0m
  node scripts/tesla-smoke.mjs navigate ${active.slug} ${unvisited[0]?.id ?? "<stopId>"}
  node scripts/tesla-smoke.mjs watch ${active.slug}`);
  return true;
}

// ── navigate (commands the car) ────────────────────────────────────────────
async function navigate(slug, stopId) {
  if (!(await confirm(`Send stop ${stopId} to the car NOW? This changes the car's navigation.`))) return;
  const t0 = Date.now();
  const r = await api("/api/tesla/navigate", { method: "POST", body: { slug, stopId: Number(stopId) } });
  const ms = Date.now() - t0;
  if (r.status === 200 && r.json.ok) {
    ok(`car is navigating to ${r.json.destination} (${ms}ms)`);
    info("If the car was asleep Tessie woke it first — that's the slow part.");
  } else {
    bad(`navigate → ${r.status} ${JSON.stringify(r.json)}`);
    if (r.status === 502) info("502 = Tessie rejected/failed. Token valid? VIN right? Car reachable?");
  }
}

// ── simulate a park (no driving required) ──────────────────────────────────
async function simulatePark(slug, stopId) {
  const { detail } = await activeDrive();
  const stop = (detail?.stops ?? []).find((s) => s.id === Number(stopId));
  if (!stop) return bad(`stop ${stopId} not found on the active drive`);
  if (stop.latitude == null) return bad(`stop ${stopId} has no coords`);
  if (!(await confirm(`Simulate parking at "${stop.name}"? This MARKS IT VISITED and navigates the car to the next stop.`))) return;

  const r = await api("/api/tesla/webhook", {
    method: "POST",
    secret: true,
    body: {
      id: `smoke-${Date.now()}`, // dedupe key — a fresh one each run
      vin: "SMOKE-TEST",
      event_type: "drive_state",
      latitude: stop.latitude,
      longitude: stop.longitude,
    },
  });
  if (r.status !== 200) return bad(`webhook → ${r.status} ${JSON.stringify(r.json)}`);
  ok(`webhook accepted (${JSON.stringify(r.json)})`);
  info("Processing runs in waitUntil — give it a couple of seconds…");
  await new Promise((r2) => setTimeout(r2, 4000));

  const after = await api(`/api/drive-lists/${slug}`);
  const s2 = (after.json?.stops ?? []).find((s) => s.id === Number(stopId));
  if (s2?.visited) ok(`"${s2.name}" is now marked VISITED — geo-match + auto-visit work`);
  else bad(`"${stop.name}" is still unvisited — check the worker logs (wrangler tail)`);
}

// ── telemetry ingest ───────────────────────────────────────────────────────
async function telemetry() {
  if (!(await confirm("POST one synthetic telemetry frame to TESLA_DB?"))) return;
  const r = await api("/api/tesla/telemetry", {
    method: "POST",
    secret: true,
    body: {
      vin: "SMOKE-TEST",
      createdAt: Math.floor(Date.now() / 1000), // seconds — exercises the s→ms normalization
      latitude: 37.8715,
      longitude: -122.2730,
      speed: 0,
      shift_state: "P",
      battery_level: 72,
      odometer: 12345.6,
    },
  });
  if (r.status === 200 && r.json.ok) {
    ok("telemetry frame accepted → row in TESLA_DB.tesla_telemetry_events");
    info("Verify: wrangler d1 execute TESLA_DB --remote --command \"SELECT vin,received_at,shift_state,latitude FROM tesla_telemetry_events ORDER BY id DESC LIMIT 3\"");
  } else bad(`telemetry → ${r.status} ${JSON.stringify(r.json)}`);
}

// ── watch (the one to leave running while you drive) ───────────────────────
async function watch(slug) {
  console.log(`\nWatching ${slug} — park at a stop and this should flip to VISITED on its own.\nCtrl-C to stop.\n`);
  const seen = new Map();
  for (;;) {
    const r = await api(`/api/drive-lists/${slug}`);
    const stops = r.json?.stops ?? [];
    for (const s of stops) {
      const prev = seen.get(s.id);
      if (prev === undefined) seen.set(s.id, s.visited);
      else if (prev !== s.visited) {
        seen.set(s.id, s.visited);
        console.log(`\x1b[32m${new Date().toLocaleTimeString()}  ${s.visited ? "VISITED" : "re-opened"}: ${s.name}\x1b[0m`);
      }
    }
    const done = stops.filter((s) => s.visited).length;
    process.stdout.write(`\r  ${done}/${stops.length} visited · status=${r.json?.status} · ${new Date().toLocaleTimeString()}   `);
    await new Promise((r2) => setTimeout(r2, 5000));
  }
}

// ── reset ──────────────────────────────────────────────────────────────────
async function reset(slug, stopId) {
  const r = await api(`/api/drive-lists/${slug}/stops/${stopId}`, { method: "PATCH", body: { visited: false } });
  if (r.status === 200) ok(`stop ${stopId} un-visited (drive status → ${r.json.status})`);
  else bad(`reset → ${r.status} ${JSON.stringify(r.json)}`);
}

// ── main ───────────────────────────────────────────────────────────────────
const [cmd, a, b] = process.argv.slice(2).filter((x) => x !== "-y");
console.log(`\x1b[2mhost: ${HOST}\x1b[0m`);
switch (cmd) {
  case "preflight": await preflight(); break;
  case "navigate": await navigate(a, b); break;
  case "simulate-park": await simulatePark(a, b); break;
  case "telemetry": await telemetry(); break;
  case "watch": await watch(a); break;
  case "reset": await reset(a, b); break;
  default:
    console.log(`
Commands:
  preflight                    read-only. Run this first.
  navigate <slug> <stopId>     push a destination to the car
  simulate-park <slug> <stop>  fake a park event (no driving needed)
  telemetry                    post one synthetic frame
  watch <slug>                 live drive state — leave running while you drive
  reset <slug> <stopId>        un-visit a stop
`);
}
