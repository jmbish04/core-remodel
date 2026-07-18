#!/usr/bin/env node
/**
 * @fileoverview Live smoke test for the showroom sales/clearance API
 * (src/backend/api/routes/showroom-sales.ts).
 *
 * WHY THIS EXISTS: those routes are behind `requireAccessAuth`, whose secret
 * (`WORKER_API_KEY`) is a `remote: true` secrets-store binding — so `wrangler
 * dev` 500s on every authed route locally and the feature can't be exercised
 * there. This hits the DEPLOYED worker instead, authenticating with the same
 * key the store holds, pulled from the `tokens` CLI (see tokens.mjs).
 *
 * The auth model (utils/access.ts): routes trust a `remodel_access` cookie whose
 * value is the SHA-256 hex of the trimmed WORKER_API_KEY. No login round-trip
 * needed — we derive that cookie directly.
 *
 * Usage:
 *   node scripts/test_sales.mjs                      # read-only, against prod
 *   node scripts/test_sales.mjs --sweep --limit 5    # also run a bounded sweep
 *   node scripts/test_sales.mjs --base https://<preview-url>
 *   BASE_URL=https://<preview-url> node scripts/test_sales.mjs
 *
 * Flags:
 *   --base <url>   worker base URL (default: $BASE_URL or the prod workers.dev)
 *   --sweep        POST /sweep first (costs Browser Rendering + AI calls)
 *   --limit <n>    pages the sweep scans (default 5)
 *   --q <text>     query used for the keyword + RAG search checks
 *   --store <id>   store id for the per-store clearance check
 *
 * Exit code is non-zero if any check fails.
 */
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";

import { getToken } from "./tokens.mjs";

const DEFAULT_BASE = "https://core-remodel.hacolby.workers.dev";

const { values } = parseArgs({
  options: {
    base: { type: "string" },
    sweep: { type: "boolean", default: false },
    limit: { type: "string", default: "5" },
    q: { type: "string", default: "marble" },
    store: { type: "string" },
  },
  allowPositionals: true,
});

const BASE = (values.base ?? process.env.BASE_URL ?? DEFAULT_BASE).replace(/\/+$/, "");

// ── Auth cookie ────────────────────────────────────────────────────────────
// access.ts hashes the TRIMMED key; getToken already trims, but be explicit.
const apiKey = getToken("WORKER_API_KEY").trim();
const accessCookie = `remodel_access=${createHash("sha256").update(apiKey).digest("hex")}`;

const authedHeaders = { cookie: accessCookie };

// ── Tiny assert harness ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function ok(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** GET/POST helper. Returns { status, json, text }. Never throws on HTTP status. */
async function req(method, path, { auth = true, body } = {}) {
  const headers = { ...(auth ? authedHeaders : {}) };
  if (body !== undefined) headers["content-type"] = "application/json";
  const init = { method, headers };
  // Only attach a body for non-GET — fetch rejects a body on GET.
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON (e.g. an HTML error page) — leave json null */
  }
  return { status: res.status, json, text };
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nSales API smoke test → ${BASE}\n`);

  // 0. Control: /api/health needs no auth. If this fails the target is wrong or
  //    down, and every check below is meaningless — bail early with a clear note.
  const health = await req("GET", "/api/health", { auth: false });
  ok("GET /api/health → 200 (target reachable)", health.status === 200, `got ${health.status}`);
  if (health.status !== 200) {
    console.log("\nTarget not reachable / not a core-remodel worker. Aborting.\n");
    process.exit(1);
  }

  // 1. Auth gate actually bites: no cookie → 401, not 200.
  const noAuth = await req("GET", "/api/showroom-sales/facets", { auth: false });
  ok(
    "facets WITHOUT cookie → 401 (auth enforced)",
    noAuth.status === 401,
    `got ${noAuth.status}`,
  );

  // 2. Optional sweep — populates data so the read checks have something to see.
  if (values.sweep) {
    const limit = Number(values.limit) || 5;
    console.log(`\n  … running sweep (limit ${limit}) — this hits Browser Rendering + AI\n`);
    const sweep = await req("POST", "/api/showroom-sales/sweep", { body: { limit } });
    ok("POST /sweep → 200", sweep.status === 200, `got ${sweep.status}: ${sweep.text.slice(0, 200)}`);
    if (sweep.json) {
      const s = sweep.json;
      ok(
        "sweep summary has the expected shape",
        ["pagesScanned", "recorded", "unchanged", "empty", "errors"].every((k) => k in s),
        JSON.stringify(s),
      );
      console.log(
        `    pages=${s.pagesScanned} stores=${s.storesScanned} recorded=${s.recorded} ` +
          `unchanged=${s.unchanged} empty=${s.empty} errors=${s.errors}`,
      );
    }
  }

  // 3. Facets — dynamic filter vocabulary.
  const facets = await req("GET", "/api/showroom-sales/facets");
  ok("GET /facets → 200", facets.status === 200, `got ${facets.status}`);
  if (facets.json) {
    ok(
      "facets shape (brands/categories/stores/totalItems)",
      ["brands", "categories", "dealLabels", "cities", "stores", "totalItems"].every(
        (k) => k in facets.json,
      ),
      JSON.stringify(Object.keys(facets.json)),
    );
    console.log(
      `    ${facets.json.totalItems} items · ${facets.json.storeCount} showrooms · ` +
        `${facets.json.categories?.length ?? 0} categories · ${facets.json.brands?.length ?? 0} brands`,
    );
  }

  // 4. Keyword list.
  const kw = await req("GET", `/api/showroom-sales?q=${encodeURIComponent(values.q)}`);
  ok("GET / (keyword) → 200", kw.status === 200, `got ${kw.status}`);
  ok("keyword result has items[] + mode", kw.json != null && Array.isArray(kw.json.items), "");
  if (kw.json) console.log(`    mode=${kw.json.mode} · ${kw.json.items?.length ?? 0} items`);

  // 5. RAG list — exercises the embedding call + Vectorize query, then the
  //    keyword fallback when nothing is indexed yet.
  const rag = await req("GET", `/api/showroom-sales?mode=rag&q=${encodeURIComponent(values.q)}`);
  ok("GET / (rag) → 200", rag.status === 200, `got ${rag.status}`);
  if (rag.json) {
    ok(
      "rag mode resolves to 'rag' or falls back to 'keyword'",
      rag.json.mode === "rag" || rag.json.mode === "keyword",
      `mode=${rag.json.mode}`,
    );
    console.log(`    resolved mode=${rag.json.mode} · ${rag.json.items?.length ?? 0} items`);
  }

  // 6. Per-store clearance (the viewport alert source). Uses --store, else the
  //    first store that showed up in the facets, else skips.
  const storeId = values.store ?? facets.json?.stores?.[0]?.id;
  if (storeId != null) {
    const store = await req("GET", `/api/showroom-sales/store/${storeId}`);
    ok(`GET /store/${storeId} → 200`, store.status === 200, `got ${store.status}`);
    ok("store clearance has sales[] + itemCount", store.json != null && Array.isArray(store.json.sales), "");
    if (store.json) console.log(`    ${store.json.itemCount ?? 0} active clearance items`);
  } else {
    console.log("  · per-store check skipped (no store id and no facet data — run --sweep first)");
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("\nUnexpected error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
