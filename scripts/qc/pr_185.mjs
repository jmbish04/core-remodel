#!/usr/bin/env node
/**
 * @fileoverview QC — PR #185, per-API Google Maps quota hard-block (0023 WS-B).
 *
 *   pnpm run test:pr 185 -- --preview   # this branch's preview worker (new fields)
 *   pnpm run test:pr 185                 # production — by_sku/quotas report PENDING
 *                                        # until merge+deploy
 *
 * The per-API guard lives in the service layer (isUnderApiQuota / reverseGeocode /
 * placesNearby) and isn't a standalone HTTP route, so the observable surface is the
 * admin usage endpoint growing `by_sku` + `quotas`. Admin-gated (uses the cookie).
 */
import { createClient, createChecks, assertReachable, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(`\nQC pr_185 — per-API Maps quota\n  target: ${resolveBase()}${onProd ? " (PROD — by_sku/quotas PENDING until merge+deploy)" : ""}\n`);

await assertReachable(client, checks);

const usage = await client.get("/api/admin/integrations/usage");
const okBase = checks.ok(
  "GET /api/admin/integrations/usage → 200 (regression)",
  usage.status === 200,
  `→ ${usage.status}`,
);

if (okBase) {
  // Existing fields still present (regression guard on the shape).
  checks.ok(
    "usage keeps total_requests + by_endpoint (regression)",
    typeof usage.json?.total_requests === "number" && typeof usage.json?.by_endpoint === "object",
  );

  const hasSku = usage.json?.by_sku && usage.json?.quotas;
  if (onProd && !hasSku) {
    checks.info("PENDING (prod): by_sku/quotas not deployed yet — expected before merge.");
  } else {
    const skus = ["places", "geocoding", "routes"];
    checks.ok(
      "usage exposes per-SKU counts (by_sku.places/geocoding/routes)",
      hasSku && skus.every((s) => typeof usage.json.by_sku[s] === "number"),
      `by_sku=${JSON.stringify(usage.json?.by_sku)}`,
    );
    checks.ok(
      "usage exposes per-SKU caps (quotas.places/geocoding/routes > 0)",
      hasSku && skus.every((s) => typeof usage.json.quotas[s] === "number" && usage.json.quotas[s] > 0),
      `quotas=${JSON.stringify(usage.json?.quotas)}`,
    );
  }

  // Auth guard: the admin endpoint must reject an unauthenticated caller.
  const unauth = await client.get("/api/admin/integrations/usage", { auth: false });
  checks.ok("usage without auth → 401/403", unauth.status === 401 || unauth.status === 403, `→ ${unauth.status}`);
}

checks.finish();
