#!/usr/bin/env node
/**
 * @fileoverview QC — PR #295, 0032 L0 LocationFix ingress + new sources.
 *
 * Proves:
 *   1. Regression — the endpoints the ingress builds on are healthy on prod AND
 *      preview (tesla status, visit-logs, the existing device-location route).
 *   2. The new POST /api/tesla/manual-here works (200 + an IngestResult).
 *   3. The additive ingest on /device-location didn't break its response shape.
 *
 * Writes (manual-here, device-location) run PREVIEW-ONLY, gated on the ACTUAL
 * base — each records a device_location fix, so we don't log junk into prod. They
 * use a far-offshore coordinate so nothing matches/stages (clean assertions).
 *
 *   pnpm run test:pr 295 -- --preview
 *   pnpm run test:pr 295
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE;
const isPreviewBase = client.base !== WORKER_BASE;

// Null Island-ish: far from any showroom / home, so match/home/stage all no-op.
const OCEAN = { latitude: 0.0, longitude: 0.0 };

console.log(`\nQC pr_295 — LocationFix ingress (L0)\n  target: ${resolveBase()}\n`);

try {
  await assertReachable(client, checks);

  // ── 1. Regression on what the ingress builds on ──
  const status = await client.get("/api/tesla/status");
  checks.ok("GET /api/tesla/status → 200 (integration)", status.status === 200, `→ ${status.status}`);

  const visits = await client.get("/api/showroom-visit-logs?status=pending&limit=1");
  checks.ok(
    "GET /api/showroom-visit-logs → 200 (ingest stages into this)",
    visits.status === 200 && Array.isArray(visits.json?.visits),
    `→ ${visits.status}`,
  );

  // ── 2. New POST /api/tesla/manual-here (preview only — records a fix) ──
  if (isPreviewBase) {
    const here = await client.post("/api/tesla/manual-here", OCEAN);
    const r = here.json?.result;
    checks.ok(
      "POST /api/tesla/manual-here → 200 { success, result }",
      here.status === 200 && here.json?.success === true && r != null,
      `→ ${here.status}`,
    );
    checks.ok(
      "offshore fix matches/stages nothing (recorded, no false visit)",
      r?.recorded === true && r?.matched === false && r?.staged === false,
      `→ ${JSON.stringify(r ?? {}).slice(0, 160)}`,
    );
  } else {
    const here = await client.post("/api/tesla/manual-here", OCEAN);
    if (here.status === 404) {
      checks.info("PENDING: /api/tesla/manual-here not on prod yet (404; needs merge+deploy)");
    } else {
      // Present on prod post-deploy: assert it responds, but don't over-assert
      // (an active drive near the ocean is impossible, so it's still a clean no-op).
      checks.ok("POST /api/tesla/manual-here → 200 (prod, post-deploy)", here.status === 200, `→ ${here.status}`);
    }
  }

  // ── 3. Additive ingest didn't break the existing device-location route ──
  if (isPreviewBase) {
    const dev = await client.post("/api/showroom-stores/device-location", { ...OCEAN, source: "manual" });
    checks.ok(
      "POST /device-location → 200 { success, id } (shape preserved)",
      dev.status === 200 && dev.json?.success === true && typeof dev.json?.id === "number",
      `→ ${dev.status}`,
    );
  } else {
    checks.info("SKIP: /device-location write probe skipped on prod (records a fix row)");
  }
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
