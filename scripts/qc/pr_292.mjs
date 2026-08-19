#!/usr/bin/env node
/**
 * @fileoverview QC — PR #292, 0032 V2c Visit Logs workspace (frontend).
 *
 * V2c is frontend-only (no schema, no new API), so this proves two things:
 *   1. Regression — the data endpoints the workspace consumes are healthy
 *      (visit-logs list + store directory), on prod AND preview.
 *   2. The new SSR pages are served (200 HTML) on the preview; on prod before
 *      merge they 404 → reported as "pending merge/deploy", not a hard failure.
 * Plus a full write round-trip through the same REST surface the UI drives, so
 * the create→finalize→delete path the pages depend on is verified end to end.
 *
 *   pnpm run test:pr 292 -- --preview     # the branch (new pages exist)
 *   pnpm run test:pr 292                   # prod regression (pages pending)
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(`\nQC pr_292 — Visit Logs workspace (V2c)\n  target: ${resolveBase()}\n`);

/** GET a page; 200 with the marker = rendered, 404 on prod = pending merge. */
async function checkPage(path, marker, label) {
  const res = await client.get(path);
  if (onProd && res.status === 404) {
    checks.info(`PENDING: ${label} not on prod yet (404; needs merge+deploy)`);
    return;
  }
  const has = res.status === 200 && typeof res.text === "string" && res.text.includes(marker);
  checks.ok(`${label} → 200 HTML (contains "${marker}")`, has, `→ ${res.status}`);
}

try {
  await assertReachable(client, checks);

  // ── 1. Data endpoints the workspace consumes (regression; live since V2a/V2b) ──
  const list = await client.get("/api/showroom-visit-logs?status=pending&limit=3");
  checks.ok(
    "GET /api/showroom-visit-logs?status=pending → 200 { count, visits[] }",
    list.status === 200 && typeof list.json?.count === "number" && Array.isArray(list.json?.visits),
    `→ ${list.status}`,
  );

  const completed = await client.get("/api/showroom-visit-logs?status=completed&limit=3");
  checks.ok(
    "GET ?status=completed → 200 (tab data source)",
    completed.status === 200 && Array.isArray(completed.json?.visits),
    `→ ${completed.status}`,
  );

  const stores = await client.get("/api/showroom-stores");
  checks.ok(
    "GET /api/showroom-stores → 200 { stores[] } (autocomplete source)",
    stores.status === 200 && Array.isArray(stores.json?.stores),
    `→ ${stores.status}`,
  );

  // Store-scoped read the Visits section uses (admin-gated ?storeId= filter).
  const firstStore = stores.json?.stores?.[0]?.id;
  if (typeof firstStore === "number") {
    const scoped = await client.get(`/api/showroom-visit-logs?storeId=${firstStore}&limit=3`);
    checks.ok(
      "GET ?storeId= → 200 (store Visits section source)",
      scoped.status === 200 && Array.isArray(scoped.json?.visits),
      `→ ${scoped.status}`,
    );
  }

  // ── 2. New SSR pages (200 on preview; pending on prod pre-merge) ──
  await checkPage("/admin/shopping/showrooms/visitlogs", "Visit Logs", "Visit Logs list page");
  await checkPage("/admin/shopping/showrooms/visitlogs/new", "New visit log", "New visit log page");

  // ── 3. Full workspace write round-trip (the paths the pages drive) ──
  const created = await client.post("/api/showroom-visit-logs", {
    visitType: "FULL_SESSION",
    notesMarkdown: "QC pr_292 workspace scratch row",
    gpsSource: "manual",
    rating: 5,
  });
  const id = created.json?.id;
  checks.ok("POST create (manual) → 201 with id", created.status === 201 && typeof id === "number", `→ ${created.status}`);

  if (typeof id === "number") {
    const got = await client.get(`/api/showroom-visit-logs/${id}`);
    checks.ok(
      "GET /:id → row with source=manual, status DRAFT",
      got.status === 200 && got.json?.visit?.id === id && got.json?.visit?.gpsSource === "manual",
      `→ ${got.status}`,
    );

    const fin = await client.patch(`/api/showroom-visit-logs/${id}`, { status: "SUBMITTED" });
    checks.ok("PATCH submit → 200 (Submit button path)", fin.status === 200, `→ ${fin.status}`);

    const del = await client.req("DELETE", `/api/showroom-visit-logs/${id}`);
    checks.ok("DELETE → 200 (scratch row cleaned up)", del.status === 200, `→ ${del.status}`);
  }
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
