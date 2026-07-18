#!/usr/bin/env node
/**
 * @fileoverview QC for PR #151 — showroom sales/clearance tracking, Showroom
 * Hours card, edit/intake parity, brand slideshow.
 *
 * Branch: claude/showroom-viewport-updates-133709
 * Migrations: 0111_pale_bloodaxe (showroom_store_sales + review-summary backfill)
 *
 * Run:  pnpm run test:pr 151
 *       pnpm run test:pr 151 -- --sweep      # also exercise scrape + AI extract
 *
 * Covers the API surface this PR added or changed, plus a regression guard on
 * the store-detail endpoint (it now joins brand_images for the bento slideshow,
 * so a mistake there breaks an existing, heavily-used page).
 */
import { assertReachable, createChecks, createClient } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const SWEEP = process.argv.includes("--sweep");

async function main() {
  console.log(`\nPR #151 QC → ${client.base}\n`);
  await assertReachable(client, checks);

  // ── Auth gate ──────────────────────────────────────────────────────────────
  const noAuth = await client.get("/api/showroom-sales/facets", { auth: false });
  checks.ok("sales API rejects an unauthenticated read (401)", noAuth.status === 401, `got ${noAuth.status}`);

  // ── Migration 0111 landed: the table the sales API reads exists ────────────
  // A 500 here is the signature of an unapplied migration on the target's D1.
  const facets = await client.get("/api/showroom-sales/facets");
  checks.ok(
    "GET /api/showroom-sales/facets → 200 (migration 0111 applied)",
    facets.status === 200,
    `got ${facets.status}${facets.status === 500 ? " — run `pnpm run migrate:remote`" : ""}`,
  );
  if (facets.json) {
    checks.ok(
      "facets expose the dynamic filter vocabulary",
      ["brands", "categories", "dealLabels", "cities", "stores", "totalItems"].every(
        (k) => k in facets.json,
      ),
      JSON.stringify(Object.keys(facets.json)),
    );
    checks.info(
      `${facets.json.totalItems} items · ${facets.json.storeCount} showrooms · ` +
        `${facets.json.categories?.length ?? 0} categories`,
    );
  }

  // ── List: keyword + RAG ────────────────────────────────────────────────────
  const kw = await client.get("/api/showroom-sales?q=marble");
  checks.ok("GET /api/showroom-sales (keyword) → 200", kw.status === 200, `got ${kw.status}`);
  checks.ok("keyword response shape { items[], mode }", Array.isArray(kw.json?.items) && !!kw.json?.mode);

  const rag = await client.get("/api/showroom-sales?mode=rag&q=marble%20remnants");
  checks.ok("GET /api/showroom-sales (rag) → 200", rag.status === 200, `got ${rag.status}`);
  checks.ok(
    "rag resolves to 'rag', or falls back to 'keyword' when nothing is indexed",
    rag.json?.mode === "rag" || rag.json?.mode === "keyword",
    `mode=${rag.json?.mode}`,
  );

  // ── Regression: store detail now joins brand_images (bento slideshow) ──────
  const stores = await client.get("/api/showroom-stores");
  const list = Array.isArray(stores.json) ? stores.json : (stores.json?.stores ?? []);
  checks.ok("GET /api/showroom-stores → 200", stores.status === 200, `got ${stores.status}`);

  const storeId = list?.[0]?.id;
  if (storeId != null) {
    const detail = await client.get(`/api/showroom-stores/${storeId}`);
    checks.ok(
      `GET /api/showroom-stores/${storeId} → 200 (brand_images join intact)`,
      detail.status === 200,
      `got ${detail.status}`,
    );
    checks.ok(
      "each brand carries an images[] array for the slideshow",
      (detail.json?.brands ?? []).every((b) => Array.isArray(b.images)),
      "a brand is missing images[]",
    );
    checks.ok(
      "store detail exposes links[] (hero social icons + website)",
      Array.isArray(detail.json?.links),
    );
    // The [gemini summarized] marker must not reappear — 0111 backfilled it out
    // and the maps service no longer writes it.
    checks.ok(
      "review summary carries no '[gemini summarized]' marker",
      !String(detail.json?.reviewSummary ?? "").includes("[gemini summarized]"),
      String(detail.json?.reviewSummary ?? "").slice(0, 60),
    );

    const storeSales = await client.get(`/api/showroom-sales/store/${storeId}`);
    checks.ok(
      `GET /api/showroom-sales/store/${storeId} → 200 (viewport alert source)`,
      storeSales.status === 200,
      `got ${storeSales.status}`,
    );
  }

  // ── Optional: full sweep (Browser Rendering + AI extraction + Vectorize) ───
  if (SWEEP) {
    console.log("\n  … sweeping (Browser Rendering + AI) — bounded to 3 pages\n");
    const sweep = await client.post("/api/showroom-sales/sweep", { limit: 3 });
    checks.ok("POST /api/showroom-sales/sweep → 200", sweep.status === 200, `got ${sweep.status}`);
    if (sweep.json) {
      checks.ok(
        "sweep summary shape",
        ["pagesScanned", "recorded", "unchanged", "empty", "errors"].every((k) => k in sweep.json),
      );
      // errors > 0 means a page threw — scrape, extraction, or the D1 write.
      checks.ok("sweep completed with no per-page errors", sweep.json.errors === 0, `errors=${sweep.json.errors}`);
      checks.info(
        `pages=${sweep.json.pagesScanned} recorded=${sweep.json.recorded} ` +
          `unchanged=${sweep.json.unchanged} empty=${sweep.json.empty} errors=${sweep.json.errors}`,
      );
    }
  } else {
    checks.info("(sweep skipped — pass --sweep to exercise scrape + AI extraction)");
  }

  checks.finish();
}

main().catch((err) => {
  console.error("\nUnexpected error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
