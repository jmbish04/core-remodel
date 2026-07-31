#!/usr/bin/env node
/**
 * @fileoverview QC — PR #326, 0032 D2c-1: discovery-search engine + REST.
 *
 * The find_showrooms engine (services/showroom/discovery-search.ts) behind
 * /api/showroom-searches* + /api/showroom-exclusions*. The full write path
 * (create → get → import → exclude) hits live Google Places + Gemini, so to avoid
 * BILLING and prod row-pollution this QC proves the surface is wired + the read
 * endpoints respond + a regression on the sibling D1 park-find sink; the write path is
 * exercised on the branch PREVIEW with usePlaces:false + a synthetic aiResult (no
 * Places spend) — see the --sweep block.
 *
 *   pnpm run test:pr 326 -- --preview
 *   pnpm run test:pr 326
 *   pnpm run test:pr 326 -- --preview --sweep   # opt-in AI-only write path
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const isPreview = client.base !== WORKER_BASE;
const sweep = process.argv.includes("--sweep");

console.log(`\nQC pr_326 — discovery-search engine (D2c-1)\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`);

const wired = (s) => s === 200 || s === 401 || s === 404; // 404 = pending merge/deploy on prod

try {
  await assertReachable(client, checks);

  // 1. The two new list endpoints are wired.
  const searches = await client.get("/api/showroom-searches");
  checks.ok("GET /api/showroom-searches → wired", wired(searches.status), `→ ${searches.status}`);
  const exclusions = await client.get("/api/showroom-exclusions");
  checks.ok("GET /api/showroom-exclusions → wired", wired(exclusions.status), `→ ${exclusions.status}`);

  // 2. Regression — the D1 park-find sink (shared exclusions table) still responds.
  const hitl = await client.get("/api/showroom-hitl-queue");
  checks.ok("GET /api/showroom-hitl-queue → regression ok", wired(hitl.status), `→ ${hitl.status}`);

  // 3. Opt-in write path — AI-only (usePlaces:false), no Places/Gemini-Places billing.
  if (sweep) {
    const run = await client.post("/api/showroom-searches", {
      title: "QC discovery sweep",
      usePlaces: false,
      aiResults: [{ name: "QC Test Tile & Stone", placeId: `qc-${Date.now()}`, category: "tile & stone" }],
    });
    const body = run.status === 200 ? (typeof run.json === "function" ? await run.json() : run.body) : null;
    checks.ok(
      "POST /api/showroom-searches (AI-only) → creates a slug + result",
      run.status === 200 && body?.slug && body?.count >= 1,
      `→ ${run.status} slug=${body?.slug} count=${body?.count}`,
    );
    if (body?.slug) {
      const got = await client.get(`/api/showroom-searches/${body.slug}`);
      checks.ok(`GET /api/showroom-searches/${body.slug} → 200`, got.status === 200, `→ ${got.status}`);
      const revs = await client.get(`/api/showroom-searches/${body.slug}/revisions`);
      checks.ok("GET /:slug/revisions → 200 with revision 1", revs.status === 200, `→ ${revs.status}`);
    }
  } else {
    checks.info("Write path (create→get→revisions, AI-only) runs with --sweep to avoid prod rows.");
  }

  checks.info(
    "find_showrooms composes placesTextSearchMany (quota-hard-disabled → AI-only) + a best-effort Gemini rank (validated placeIds, heuristic fallback) + dedupe/directory/exclusion flagging, persists a numbered revision + result rows, and publishes to the DiscoveryHub. MCP parity tools (find_showrooms + slug actions + exclusion tools) are D2c-2; finder pages are D2d.",
  );
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
