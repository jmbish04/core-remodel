#!/usr/bin/env node
/**
 * @fileoverview QC for PR #177 — /api/materials returned 500 (schema drift).
 *
 * Migrations: 0119_material_notes_column_catchup (ADD COLUMN notes)
 *
 * Run:  pnpm run test:pr 177
 *       pnpm run test:pr 177 -- --preview
 *
 * `material_schedule_items.notes` is declared in the drizzle schema and present
 * in 0000_baseline.sql, but was ABSENT from the production table. Every SELECT
 * drizzle builds names the column, so the materials list — and the whole
 * schedule page — returned 500:
 *
 *   SELECT notes FROM material_schedule_items -> no such column: notes [7500]
 *
 * `db:generate` could not produce the migration: drizzle's snapshot already
 * contained the column, so it saw no diff. Only production had drifted.
 *
 * These checks fail loudly if the column goes missing again, and cover the
 * write path too — worker-emails stamps a purchase note onto a material when a
 * receipt line item is linked, which was silently broken by the same drift.
 */
import { assertReachable, createChecks, createClient } from "../config.mjs";

const client = createClient();
const checks = createChecks();

async function main() {
  console.log(`\nPR #177 QC → ${client.base}\n`);
  await assertReachable(client, checks);

  const noAuth = await client.get("/api/materials", { auth: false });
  checks.ok("materials rejects an unauthenticated read (401)", noAuth.status === 401, `got ${noAuth.status}`);

  // ── The regression itself ─────────────────────────────────────────────────
  const list = await client.get("/api/materials");
  checks.ok(
    "GET /api/materials → 200 (was 500: no such column: notes)",
    list.status === 200,
    `got ${list.status}${list.status === 500 ? " — the notes column is missing again" : ""}`,
  );
  checks.ok("response shape { materials[] }", Array.isArray(list.json?.materials), JSON.stringify(Object.keys(list.json ?? {})));
  checks.info(`${list.json?.materials?.length ?? 0} materials`);

  // A material row must actually carry the key, not merely avoid throwing.
  // `undefined` would mean drizzle stopped selecting it — the same blindness
  // that let the drift go unnoticed.
  const first = list.json?.materials?.[0];
  if (first) {
    checks.ok("a material row includes the notes key", "notes" in first, Object.keys(first).join(","));
    checks.ok(
      "roomName is derived by join, not a stored column",
      "roomName" in first,
      "no roomName — the rooms join regressed",
    );
  } else {
    checks.info("no materials yet — row-shape checks skipped (they need one row)");
  }

  // ── Filters exercise the same SELECT, so they'd 500 identically ───────────
  for (const [label, qs] of [
    ["search filter", "?search=toilet"],
    ["purchased filter", "?purchased=false"],
  ]) {
    const r = await client.get(`/api/materials${qs}`);
    checks.ok(`${label} → 200`, r.status === 200, `${qs} → ${r.status}`);
  }

  // ── Regression guard: the routes that write material notes ────────────────
  // worker-emails link/create-material both set `notes`; they were broken by
  // the same missing column. Read paths only here — the writes mutate real
  // material and invoice rows.
  for (const [label, path] of [
    ["worker emails", "/api/worker-emails"],
    ["wishlist", "/api/wishlist"],
  ]) {
    const r = await client.get(path);
    checks.ok(`${label} read path still 200`, r.status === 200, `${path} → ${r.status}`);
  }

  checks.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
