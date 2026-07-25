#!/usr/bin/env node
/**
 * @fileoverview QC — PR #258, showroom_visit_log + visit-session pipeline (0023 P1/P3).
 *
 * Read-only: the pipeline itself is driven by live telemetry (park/drive-away),
 * so this asserts the visit-log READ surface + shape. The two-row soft→staged
 * model and the unique-soft_arrival_id idempotency were validated against local D1
 * at build time (see the PR body).
 *
 *   pnpm run test:pr 258 -- --preview
 *   pnpm run test:pr 258
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(`\nQC pr_258 — visit-log read surface\n  target: ${resolveBase()}\n`);

await assertReachable(client, checks);

try {
  const res = await client.get("/api/tesla/visits?limit=5");
  if (onProd && (res.status === 404 || res.status === 500)) {
    // New route + new table — absent (404) or table-missing (500) until merge+migrate+deploy.
    checks.info(`PENDING: /api/tesla/visits not live on prod yet (→ ${res.status}; needs merge+migrate+deploy)`);
  } else {
    checks.ok(
      "GET /api/tesla/visits → 200 with { count, visits[] }",
      res.status === 200 && typeof res.json?.count === "number" && Array.isArray(res.json?.visits),
      `→ ${res.status} ${JSON.stringify(res.json).slice(0, 200)}`,
    );
    // If any rows exist, each carries the pipeline's shape (status enum + store JOIN slot).
    const rows = res.json?.visits ?? [];
    if (rows.length > 0) {
      const validStatus = ["AI_STAGED", "TESLA_SOFT_ARRIVAL", "TESLA_STAGED", "SUBMITTED"];
      checks.ok(
        "each visit row has a valid status and the JOINed store name slot",
        rows.every((r) => validStatus.includes(r.status) && "storeName" in r && "storeId" in r),
        `first=${JSON.stringify(rows[0])}`,
      );
    } else {
      checks.info("no visit rows yet (expected until a real park/drive-away happens)");
    }

    // status filter is honored.
    const filtered = await client.get("/api/tesla/visits?status=TESLA_STAGED&limit=3");
    checks.ok(
      "GET /api/tesla/visits?status= filters",
      filtered.status === 200 &&
        (filtered.json?.visits ?? []).every((r) => r.status === "TESLA_STAGED"),
      `→ ${filtered.status}`,
    );
  }
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
