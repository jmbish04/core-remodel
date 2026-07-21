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

  // ── Leave prod in the intended end state: newest drive active ───────────
  const restoreActive = await client.patch(`/api/drive-lists/${newest.slug}`, { isActive: true });
  checks.ok(`final state — ${newest.slug} is the active drive`, restoreActive.status === 200, `got ${restoreActive.status}`);
  const done = await listDrives();
  checks.ok(
    "exactly one active drive at rest",
    activeOnes(done.drives).length === 1 && activeOnes(done.drives)[0].id === newest.id,
    activeOnes(done.drives).map((d) => d.slug).join(", "),
  );

  checks.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
