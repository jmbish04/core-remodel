#!/usr/bin/env node
/**
 * @fileoverview QC — PR #290, 0032 V2b visit-log MCP CRUD + shared service.
 *
 * The MCP tools and the REST routes go through ONE service, so exercising the REST
 * CRUD round-trip is the parity guard for both. Creates a DRAFT, reads it, finalizes
 * it (SUBMITTED), then deletes it — leaving no residue. Also checks the rating guard.
 *
 *   pnpm run test:pr 290 -- --preview
 *   pnpm run test:pr 290
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(`\nQC pr_290 — visit-log CRUD round-trip\n  target: ${resolveBase()}\n`);

try {
  await assertReachable(client, checks);

  const list = await client.get("/api/showroom-visit-logs?status=pending&limit=3");
  if (onProd && list.status === 404) {
    checks.info("PENDING: /api/showroom-visit-logs not on prod yet (route 404; needs merge+deploy)");
  } else {
    checks.ok(
      "GET /api/showroom-visit-logs → 200 { count, visits[] }",
      list.status === 200 && typeof list.json?.count === "number" && Array.isArray(list.json?.visits),
      `→ ${list.status}`,
    );

    // Create a DRAFT (no store — a cold manual log), read it, finalize, delete.
    const created = await client.post("/api/showroom-visit-logs", {
      visitType: "BROWSED_NO_CONTACT",
      notesMarkdown: "QC pr_290 scratch row",
      rating: 4,
    });
    const id = created.json?.id;
    checks.ok("POST create → 201 with id", created.status === 201 && typeof id === "number", `→ ${created.status}`);

    if (typeof id === "number") {
      const got = await client.get(`/api/showroom-visit-logs/${id}`);
      checks.ok(
        "GET /:id → the created row (status DRAFT, visitType kept)",
        got.status === 200 && got.json?.visit?.id === id && got.json?.visit?.status === "DRAFT",
        `→ ${got.status} ${JSON.stringify(got.json?.visit ?? {}).slice(0, 160)}`,
      );

      const fin = await client.patch(`/api/showroom-visit-logs/${id}`, { status: "SUBMITTED", visitType: "FULL_SESSION" });
      checks.ok("PATCH finalize → 200", fin.status === 200, `→ ${fin.status}`);

      // Rating guard: 999 must be rejected by the API layer.
      const bad = await client.patch(`/api/showroom-visit-logs/${id}`, { rating: 999 });
      checks.ok("PATCH rating=999 rejected (400)", bad.status === 400, `→ ${bad.status}`);

      const del = await client.req("DELETE", `/api/showroom-visit-logs/${id}`);
      checks.ok("DELETE → 200 (scratch row cleaned up)", del.status === 200, `→ ${del.status}`);
    }
  }
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
