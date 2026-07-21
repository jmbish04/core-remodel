#!/usr/bin/env node
/**
 * @fileoverview QC for PR #178 — one active drive list, enforced in D1.
 *
 * Migrations: 0119_yellow_micromax (drive_lists.is_active + the partial unique
 * index `drive_lists_single_active_uniq`).
 *
 * Run:  pnpm run test:pr 178 -- --preview     (while the PR is open)
 *       pnpm run test:pr 178                  (production, after merge)
 *
 * What was broken: "active" was a `status` enum value, so nothing stopped six
 * drives from claiming it at once, and the landing page's Active/Archived tabs
 * bucketed on that same overloaded field. This PR splits the single-slot
 * pointer (`is_active`, unique-indexed) from the lifecycle label, adds
 * `PATCH /api/drive-lists/:slug {isActive}`, and buckets the tabs on progress.
 *
 * These checks drive the toggle over the real drives and assert the invariant
 * holds after every flip, so a regression to multi-active fails loudly.
 */
import { assertReachable, createChecks, createClient } from "../config.mjs";

const client = createClient();
const checks = createChecks();

const activeOnes = (list) => list.filter((d) => d.isActive);

async function listDrives() {
  const res = await client.get("/api/drive-lists");
  return { status: res.status, drives: res.json?.driveLists ?? [] };
}

async function main() {
  console.log(`\nPR #178 QC → ${client.base}\n`);
  await assertReachable(client, checks);

  const noAuth = await client.get("/api/drive-lists", { auth: false });
  checks.ok("drive-lists rejects an unauthenticated read (401)", noAuth.status === 401, `got ${noAuth.status}`);

  // ── The list surface carries the new flag ────────────────────────────────
  const first = await listDrives();
  checks.ok("GET /api/drive-lists → 200", first.status === 200, `got ${first.status}`);
  checks.ok("at least one drive exists to test with", first.drives.length > 0, "no drives");
  if (!first.drives.length) return checks.finish();

  checks.ok(
    "every row exposes isActive (migration 0119 applied to remote)",
    first.drives.every((d) => typeof d.isActive === "boolean"),
    "isActive missing — is the column live on the remote DB?",
  );
  checks.ok(
    `at most ONE drive is active (was 6 before this PR) — now ${activeOnes(first.drives).length}`,
    activeOnes(first.drives).length <= 1,
    activeOnes(first.drives).map((d) => d.slug).join(", "),
  );

  // ── Progress buckets the landing tabs, not `status` ──────────────────────
  const bucket = (d) =>
    d.stopCount > 0 && d.visitedCount >= d.stopCount ? "finished" : d.visitedCount > 0 ? "partial" : "pending";
  const counts = first.drives.reduce((a, d) => ({ ...a, [bucket(d)]: (a[bucket(d)] ?? 0) + 1 }), {});
  checks.info(`tabs → pending=${counts.pending ?? 0} partial=${counts.partial ?? 0} finished=${counts.finished ?? 0}`);
  checks.ok(
    "every drive falls in exactly one progress bucket",
    first.drives.every((d) => ["pending", "partial", "finished"].includes(bucket(d))),
    "unbucketable row",
  );

  // ── Activate the newest drive (the documented fallback) ──────────────────
  const newest = [...first.drives].sort((a, b) => b.id - a.id)[0];
  const other = [...first.drives].sort((a, b) => b.id - a.id)[1] ?? null;

  const on = await client.patch(`/api/drive-lists/${newest.slug}`, { isActive: true });
  checks.ok(`PATCH ${newest.slug} {isActive:true} → 200`, on.status === 200, `got ${on.status}`);

  let after = await listDrives();
  checks.ok(
    "the newest drive is now THE active one",
    activeOnes(after.drives).length === 1 && activeOnes(after.drives)[0].id === newest.id,
    activeOnes(after.drives).map((d) => d.slug).join(", "),
  );

  // ── Activating another one demotes the first, in the same batch ──────────
  if (other) {
    const swap = await client.patch(`/api/drive-lists/${other.slug}`, { isActive: true });
    checks.ok(`PATCH ${other.slug} {isActive:true} → 200`, swap.status === 200, `got ${swap.status}`);
    after = await listDrives();
    checks.ok(
      "activating a second drive left exactly one active (no unique-index 500)",
      activeOnes(after.drives).length === 1 && activeOnes(after.drives)[0].id === other.id,
      activeOnes(after.drives).map((d) => d.slug).join(", "),
    );
  }

  // ── Toggling off leaves NO drive active ─────────────────────────────────
  const current = activeOnes(after.drives)[0] ?? newest;
  const off = await client.patch(`/api/drive-lists/${current.slug}`, { isActive: false });
  checks.ok(`PATCH ${current.slug} {isActive:false} → 200`, off.status === 200, `got ${off.status}`);
  after = await listDrives();
  checks.ok("no drive is active after toggling off", activeOnes(after.drives).length === 0, `${activeOnes(after.drives).length} active`);

  // ── Guards ──────────────────────────────────────────────────────────────
  const bad = await client.patch(`/api/drive-lists/${newest.slug}`, { nope: true });
  checks.ok("PATCH without `isActive` → 400", bad.status === 400, `got ${bad.status}`);
  const missing = await client.patch("/api/drive-lists/no-such-drive-slug", { isActive: true });
  checks.ok("PATCH on an unknown slug → 404", missing.status === 404, `got ${missing.status}`);

  // ── Regression: the drive viewport + check-off still work ───────────────
  const detail = await client.get(`/api/drive-lists/${newest.slug}`);
  checks.ok("GET /api/drive-lists/:slug → 200", detail.status === 200, `got ${detail.status}`);
  const stop = detail.json?.stops?.[0];
  if (stop) {
    const was = Boolean(stop.visited);
    const toggled = await client.patch(`/api/drive-lists/${newest.slug}/stops/${stop.id}`, { visited: !was });
    checks.ok("stop check-off still 200", toggled.status === 200, `got ${toggled.status}`);
    checks.ok(
      "check-off returns live progress counts",
      typeof toggled.json?.stopCount === "number" && typeof toggled.json?.visitedCount === "number",
      JSON.stringify(toggled.json),
    );
    const restore = await client.patch(`/api/drive-lists/${newest.slug}/stops/${stop.id}`, { visited: was });
    checks.ok("stop restored to its original state", restore.status === 200, `got ${restore.status}`);
    const post = await listDrives();
    checks.ok(
      "checking a stop off never activates a drive",
      activeOnes(post.drives).length === 0,
      activeOnes(post.drives).map((d) => d.slug).join(", "),
    );
  }

  // ── Home arrival ends the active drive ──────────────────────────────────
  // The rule itself (radius, 15:30 cutoff, seven days) is unit-tested in
  // scripts/tests/test_home_arrival.mjs — plain node, no bindings. Here we only
  // prove the LIVE wiring: a device fix reaches the rule and its verdict comes
  // back, and a fix nowhere near the house never ends a drive.
  await client.patch(`/api/drive-lists/${newest.slug}`, { isActive: true });

  const home = await client.get("/api/drive-lists/home-location");
  checks.ok("GET /api/drive-lists/home-location → 200", home.status === 200, `got ${home.status}`);
  checks.ok(
    "the project address geocoded to real coordinates (cached in project_system_variables)",
    Number.isFinite(home.json?.home?.latitude) && Number.isFinite(home.json?.home?.longitude),
    JSON.stringify(home.json),
  );
  checks.info(`  home: ${home.json?.home?.latitude}, ${home.json?.home?.longitude} (±${home.json?.radiusM}m after ${home.json?.afterLocalMinutes} local minutes)`);
  checks.ok(
    "the coordinates are in the Bay Area, not a null-island fallback",
    (home.json?.home?.latitude ?? 0) > 36 && (home.json?.home?.latitude ?? 0) < 39 &&
      (home.json?.home?.longitude ?? 0) < -121 && (home.json?.home?.longitude ?? 0) > -123,
    JSON.stringify(home.json?.home),
  );

  const faraway = await client.post("/api/showroom-stores/device-location", {
    latitude: 38.5816, // Sacramento — ~120km from the project.
    longitude: -121.4944,
    source: "phone",
  });
  checks.ok("POST device-location → 200", faraway.status === 200, `got ${faraway.status}`);
  checks.ok(
    "the fix is evaluated against the home-arrival rule",
    typeof faraway.json?.homeArrival?.reason === "string",
    JSON.stringify(faraway.json?.homeArrival),
  );
  checks.info(`  reason: ${faraway.json?.homeArrival?.reason}`);
  checks.ok(
    "a fix 120km from the house never ends the drive",
    faraway.json?.homeArrival?.ended === false,
    JSON.stringify(faraway.json?.homeArrival),
  );
  const stillOn = await listDrives();
  checks.ok(
    "the active drive survived a far-away fix",
    activeOnes(stillOn.drives).length === 1,
    `${activeOnes(stillOn.drives).length} active`,
  );

  // ── Leave prod in the intended end state: newest drive active ───────────
  const restoreActive = await client.patch(`/api/drive-lists/${newest.slug}`, { isActive: true });
  checks.ok(`final state — ${newest.slug} is the active drive`, restoreActive.status === 200, `got ${restoreActive.status}`);
  const done = await listDrives();
  checks.ok(
    "exactly one active drive at rest",
    activeOnes(done.drives).length === 1 && activeOnes(done.drives)[0].id === newest.id,
    activeOnes(done.drives).map((d) => d.slug).join(", "),
  );

  // ── Tesla integration config page (/admin/config/integrations/tesla) ────
  const tesla = await client.get("/api/config/tesla");
  checks.ok("GET /api/config/tesla → 200", tesla.status === 200, `got ${tesla.status}`);
  const secrets = tesla.json?.secrets ?? [];
  checks.ok(
    "all three credentials are described",
    ["TESSIE_API_TOKEN", "TESLA_BETSY_VIN", "WORKER_API_KEY"].every((b) =>
      secrets.some((s) => s.binding === b),
    ),
    secrets.map((s) => s.binding).join(","),
  );
  checks.ok(
    "credential VALUES never leave the Worker — masks are dots only",
    secrets.every((s) => !s.configured || /^•+$/.test(s.masked)),
    JSON.stringify(secrets.map((s) => s.masked)),
  );
  checks.ok(
    "the mask still reports a length, so a truncated secret is visible",
    secrets.every((s) => !s.configured || s.length > 0),
    JSON.stringify(secrets.map((s) => [s.binding, s.length])),
  );
  checks.info(`  configured=${tesla.json?.configured} telemetryRecording=${tesla.json?.telemetryRecording}`);

  // Toggle telemetry off → on, asserting the flag round-trips through D1.
  const recOff = await client.patch("/api/config/tesla", { telemetryRecording: false });
  checks.ok("PATCH /api/config/tesla {telemetryRecording:false} → 200", recOff.status === 200, `got ${recOff.status}`);
  checks.ok("recording reads back as off", recOff.json?.telemetryRecording === false, JSON.stringify(recOff.json?.telemetryRecording));
  const reread = await client.get("/api/config/tesla");
  checks.ok("the off state persisted", reread.json?.telemetryRecordingSetting === false, JSON.stringify(reread.json));
  const recOn = await client.patch("/api/config/tesla", { telemetryRecording: true });
  checks.ok("recording restored to on", recOn.json?.telemetryRecordingSetting === true, JSON.stringify(recOn.json));
  const badToggle = await client.patch("/api/config/tesla", { nope: 1 });
  checks.ok("PATCH without `telemetryRecording` → 400", badToggle.status === 400, `got ${badToggle.status}`);

  // Health screening — the point of the page: are the historical rows usable?
  const health = await client.req("POST", "/api/config/tesla/health");
  checks.ok("POST /api/config/tesla/health → 200", health.status === 200, `got ${health.status}`);
  checks.ok(
    "every probe reports a verdict",
    Array.isArray(health.json?.checks) &&
      health.json.checks.length >= 4 &&
      health.json.checks.every((c) => ["ok", "warn", "fail"].includes(c.status)),
    JSON.stringify(health.json?.checks?.map((c) => [c.id, c.status])),
  );
  for (const c of health.json?.checks ?? []) checks.info(`  [${c.status}] ${c.label} — ${c.detail}`);
  checks.ok(
    "the screening reads the historical event tables",
    typeof health.json?.stats?.webhookEvents === "number" &&
      typeof health.json?.stats?.telemetryFrames === "number",
    JSON.stringify(health.json?.stats),
  );

  // ── MCP: a model can reach the car ──────────────────────────────────────
  const docs = await client.get("/api/mcp-docs");
  checks.ok("GET /api/mcp-docs → 200", docs.status === 200, `got ${docs.status}`);
  const teslaTools = (docs.json?.tools ?? []).filter((t) => t.category === "tesla");
  checks.ok(
    "the tesla tool domain is registered (status, location, events, navigate)",
    ["get_tesla_status", "get_vehicle_location", "list_tesla_events", "send_vehicle_navigation"].every(
      (n) => teslaTools.some((t) => t.name === n),
    ),
    teslaTools.map((t) => t.name).join(","),
  );
  checks.ok(
    "every tesla tool documents an example (registry contract)",
    teslaTools.length > 0 && teslaTools.every((t) => (t.examples?.length ?? 0) > 0),
    teslaTools.map((t) => `${t.name}:${t.examples?.length ?? 0}`).join(","),
  );
  checks.ok(
    "only the navigation tool is a write — the rest are read-only",
    teslaTools.every((t) =>
      t.name === "send_vehicle_navigation" ? t.annotations?.readOnlyHint !== true : t.annotations?.readOnlyHint === true,
    ),
    teslaTools.map((t) => `${t.name}:${t.annotations?.readOnlyHint}`).join(","),
  );

  // The tools are thin wrappers over these endpoints; prove the endpoints work.
  const tessieStatus = await client.get("/api/tesla/status");
  checks.ok("GET /api/tesla/status → 200", tessieStatus.status === 200, `got ${tessieStatus.status}`);
  checks.info(`  tessie configured: ${tessieStatus.json?.configured}`);

  checks.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
