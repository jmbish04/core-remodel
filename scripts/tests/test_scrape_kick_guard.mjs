#!/usr/bin/env node
/**
 * Pins the kick-guard truth table for showroom scrape triggering.
 *
 * This exists because the bug it guards was invisible in every way that matters:
 * the store row looked fine, the intake returned 201, other enrichment ran, and
 * the scrape simply never happened. Prod evidence, 2026-07-16:
 *
 *   store  website-link lag   rag_uuid  scrape_status
 *   #131   0s (in payload)    set       kicked ok
 *   #133   +38s (research)    NULL      idle   <- never kicked
 *   #134   +10s (research)    NULL      idle   <- never kicked
 *   #135   +10s (research)    NULL      idle   <- never kicked
 *
 * The two rules that must hold, and that a `status !== "idle"` guard breaks:
 *   1. MCP-created stores INSERT with scrapeStatus "pending" before any workflow
 *      exists, so status alone cannot mean "already kicked". Guard on ragUuid.
 *   2. A store whose website arrives late (research discovers it) must still kick.
 *
 * Pure logic mirror — no bindings, no network, costs nothing.
 *
 * Usage: node scripts/tests/test_scrape_kick_guard.mjs   |   pnpm run test:kick
 */
import assert from "node:assert/strict";

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

/**
 * Mirrors the guard in services/showroom/onboarding.ts kickShowroomScrape().
 * Kept in sync by hand; if that guard changes, this must change with it.
 */
function shouldKick(store, websiteUrl) {
  if (!websiteUrl) return false;
  if (!store) return false;
  if (store.ragUuid && store.scrapeStatus !== "idle") return false;
  return true;
}

console.log("\nkick guard — the paths that must still fire");

check("frontend intake, website in the Places payload (store #131 shape)", () => {
  assert.equal(shouldKick({ scrapeStatus: "idle", ragUuid: null }, "https://x.com"), true);
});

check("THE BUG: website discovered late by research (#133/#134/#135 shape)", () => {
  // Store was created with no website; research found one ~10s later. The row is
  // still idle/null, so the kick must fire once the URL is resolved from the DB.
  assert.equal(shouldKick({ scrapeStatus: "idle", ragUuid: null }, "https://late.com"), true);
});

check("MCP-created store: 'pending' at INSERT, no workflow yet — must still kick", () => {
  // create_showroom / import_showroom_from_place set scrapeStatus:"pending" on
  // the insert as an optimistic state. A `status !== "idle"` guard would return
  // here and silently disable scraping for every MCP-created showroom.
  assert.equal(shouldKick({ scrapeStatus: "pending", ragUuid: null }, "https://x.com"), true);
});

console.log("\nkick guard — the cases that must NOT double-fire");

check("already kicked (pending + ragUuid) — the Manage backfill won the race", () => {
  assert.equal(shouldKick({ scrapeStatus: "pending", ragUuid: "u1" }, "https://x.com"), false);
});

check("in flight (running)", () => {
  assert.equal(shouldKick({ scrapeStatus: "running", ragUuid: "u1" }, "https://x.com"), false);
});

check("finished (complete) — re-scraping is the user's call, not intake's", () => {
  assert.equal(shouldKick({ scrapeStatus: "complete", ragUuid: "u1" }, "https://x.com"), false);
});

check("failed — no silent auto-retry; the Manage backfill re-runs it", () => {
  assert.equal(shouldKick({ scrapeStatus: "failed", ragUuid: "u1" }, "https://x.com"), false);
});

console.log("\nkick guard — degenerate inputs");

check("no website at all — genuinely nothing to scrape", () => {
  assert.equal(shouldKick({ scrapeStatus: "idle", ragUuid: null }, ""), false);
});

check("store vanished between insert and the deferred kick", () => {
  assert.equal(shouldKick(null, "https://x.com"), false);
});

check("idle but carrying a stale ragUuid — kick and reuse the uuid", () => {
  // triggerBackfillScrape reuses `store.ragUuid ?? randomUUID()`, so an idle row
  // with a leftover uuid is still eligible.
  assert.equal(shouldKick({ scrapeStatus: "idle", ragUuid: "stale" }, "https://x.com"), true);
});

console.log(`\n${process.exitCode ? "FAILED" : "PASSED"} — ${passed} checks\n`);
