#!/usr/bin/env node
/**
 * QC — PR #284 (0038 Phase A: sale_items schema + backfill).
 *
 * Additive schema + a one-shot backfill route. Against the branch PREVIEW this
 * runs the backfill and asserts count-parity + idempotency, and confirms the
 * new tables are queryable. Against PRODUCTION (pre-merge) it's a regression
 * guard: the existing sales endpoints must still 200; the /backfill route is
 * "pending merge/deploy" since prod doesn't run this branch yet.
 *
 *   pnpm run test:pr 284 -- --preview   # branch preview — runs the backfill
 *   pnpm run test:pr 284                # production — regression guard
 *
 * Note: preview shares production's D1, so the backfill writes real sale_items
 * rows (idempotent). That is the intended one-shot data migration.
 */
import { assertReachable, createChecks, createClient, resolveBase } from "../config.mjs";

const isPreview = process.argv.includes("--preview");
const base = resolveBase();
const client = createClient({ base });
const c = createChecks();

async function main() {
  console.log(`\nQC pr_284 — base: ${base}${isPreview ? " (preview)" : " (production)"}\n`);
  await assertReachable(client, c);

  // Regression: the existing sales surface must keep working regardless.
  const list = await client.get("/api/showroom-sales");
  c.ok("GET /api/showroom-sales → 200 (regression)", list.status === 200, `status ${list.status}`);
  const facets = await client.get("/api/showroom-sales/facets");
  c.ok("GET /api/showroom-sales/facets → 200 (regression)", facets.status === 200, `status ${facets.status}`);

  if (!isPreview) {
    // Production still runs main; the backfill route ships with this PR.
    const probe = await client.post("/api/showroom-sales/backfill", {});
    if (probe.status === 404) {
      c.info("POST /backfill → 404 on prod (pending merge/deploy) — expected");
    } else {
      c.info(`POST /backfill → ${probe.status} on prod (already deployed?)`);
    }
    finishAndExit();
    return;
  }

  // --- preview: exercise the backfill ---
  const first = await client.post("/api/showroom-sales/backfill", {});
  c.ok("POST /backfill → 200", first.status === 200, `status ${first.status}`);
  const r1 = first.json || {};
  console.log("  backfill:", JSON.stringify(r1));

  c.ok("backfill reports ok", r1.ok === true);
  c.ok(
    "count parity: itemsInserted === itemsExpected on first run",
    typeof r1.itemsInserted === "number" &&
      typeof r1.itemsExpected === "number" &&
      r1.itemsInserted === r1.itemsExpected,
    `inserted ${r1.itemsInserted} vs expected ${r1.itemsExpected}`,
  );

  // Idempotency: a second run inserts nothing new and skips the same snapshots.
  const second = await client.post("/api/showroom-sales/backfill", {});
  const r2 = second.json || {};
  console.log("  re-run:", JSON.stringify(r2));
  c.ok("idempotent: second run inserts 0 items", r2.itemsInserted === 0, `inserted ${r2.itemsInserted}`);
  c.ok(
    "idempotent: second run backfills 0 snapshots",
    r2.snapshotsBackfilled === 0,
    `backfilled ${r2.snapshotsBackfilled}`,
  );

  finishAndExit();
}

function finishAndExit() {
  const { passed, failed } = c.summary();
  console.log(`\n${passed} passed, ${failed} failed\n`);
  c.finish();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
