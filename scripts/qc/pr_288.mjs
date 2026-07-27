#!/usr/bin/env node
/**
 * @fileoverview QC — PR #288, 0032 V2a visit-log REST CRUD.
 *
 * Exercises the full round-trip against the deployed worker: list (pending/
 * completed shape) + create → get → patch(finalize) → delete. Self-cleans the
 * row it creates. On prod pre-deploy the route 404s → reported pending (not a
 * failure); a 500 there is a real failure.
 *
 *   pnpm run test:pr 288 -- --preview
 *   pnpm run test:pr 288
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(`\nQC pr_288 — visit-log REST CRUD\n  target: ${resolveBase()}\n`);

try {
  await assertReachable(client, checks);

  const list = await client.get("/api/showroom-visit-logs?status=pending&limit=3");
  if (onProd && list.status === 404) {
    checks.info("PENDING: /api/showroom-visit-logs not on prod yet (404; needs merge+deploy)");
  } else {
    checks.ok(
      "GET /api/showroom-visit-logs?status=pending → 200 { count, visits[] }",
      list.status === 200 && typeof list.json?.count === "number" && Array.isArray(list.json?.visits),
      `→ ${list.status} ${JSON.stringify(list.json ?? {}).slice(0, 160)}`,
    );

    // Full CRUD round-trip (create a throwaway draft, finalize it, delete it).
    const created = await client.post("/api/showroom-visit-logs", {
      visitType: "BROWSED_NO_CONTACT",
      notesMarkdown: "QC pr_288 throwaway",
      rating: 4,
    });
    const id = created.json?.id;
    checks.ok(
      "POST /api/showroom-visit-logs → 201 with an id",
      created.status === 201 && typeof id === "number",
      `→ ${created.status} ${JSON.stringify(created.json ?? {}).slice(0, 120)}`,
    );

    if (typeof id === "number") {
      const got = await client.get(`/api/showroom-visit-logs/${id}`);
      checks.ok(
        "GET /:id → 200, status DRAFT, visit_type echoed",
        got.status === 200 && got.json?.visit?.status === "DRAFT" && got.json?.visit?.visitType === "BROWSED_NO_CONTACT",
        `→ ${got.status} ${JSON.stringify(got.json?.visit ?? {}).slice(0, 160)}`,
      );

      const patched = await client.patch(`/api/showroom-visit-logs/${id}`, { status: "SUBMITTED", rating: 5 });
      checks.ok("PATCH /:id (finalize) → 200", patched.status === 200, `→ ${patched.status}`);

      // Bad rating must be rejected by the API-layer 1–5 guard.
      const badRating = await client.patch(`/api/showroom-visit-logs/${id}`, { rating: 99 });
      checks.ok("PATCH /:id rating=99 → 400 (API rating guard)", badRating.status === 400, `→ ${badRating.status}`);

      const del = await client.req("DELETE", `/api/showroom-visit-logs/${id}`);
      checks.ok("DELETE /:id → 200 (cleanup)", del.status === 200, `→ ${del.status}`);
    }
  }
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
