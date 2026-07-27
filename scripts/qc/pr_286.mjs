#!/usr/bin/env node
/**
 * @fileoverview QC — PR #286, 0032 V1 showroom_visit_log reconcile (engagement visit_type + provenance).
 *
 * Schema-only slice: no new endpoint. This is a REGRESSION GUARD — the three added
 * columns (visit_type / match_distance_m / provenance_json) must not break the
 * existing GET /api/tesla/visits read. The visit_type/provenance surfacing lands
 * with V2 (the Visit Logs workspace); asserted then.
 *
 *   pnpm run test:pr 286 -- --preview
 *   pnpm run test:pr 286
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(`\nQC pr_286 — visit_log reconcile (regression guard)\n  target: ${resolveBase()}\n`);

try {
  await assertReachable(client, checks);

  const res = await client.get("/api/tesla/visits?limit=5");
  if (onProd && res.status === 404) {
    checks.info("PENDING: /api/tesla/visits not on prod yet (route 404; needs merge+deploy)");
  } else {
    checks.ok(
      "GET /api/tesla/visits → 200 with { count, visits[] } (added columns didn't break the read)",
      res.status === 200 && typeof res.json?.count === "number" && Array.isArray(res.json?.visits),
      `→ ${res.status} ${JSON.stringify(res.json ?? {}).slice(0, 200)}`,
    );
    const rows = res.json?.visits ?? [];
    if (rows.length > 0) {
      const valid = ["AI_STAGED", "TESLA_SOFT_ARRIVAL", "TESLA_STAGED", "SUBMITTED"];
      checks.ok(
        "each visit row still carries a valid status",
        rows.every((r) => valid.includes(r.status)),
        `first=${JSON.stringify(rows[0] ?? {}).slice(0, 200)}`,
      );
    } else {
      checks.info("no visit rows yet (expected until a real park/drive-away stages one)");
    }
  }
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
