#!/usr/bin/env node
/**
 * @fileoverview QC — PR #293, 0032 C1 Tesla location config page.
 *
 * Frontend page over existing endpoints (no schema, no new API). Proves:
 *   1. Regression — the endpoints the page reads are healthy on prod AND preview
 *      (config KV, tesla integration status, primary property).
 *   2. The new SSR page is served (200 HTML) on preview; 404-on-prod = pending.
 *   3. The config KV write path round-trips (a scratch key written then blanked)
 *      — PREVIEW ONLY, so prod config is never polluted with a probe key.
 *
 *   pnpm run test:pr 293 -- --preview
 *   pnpm run test:pr 293
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(`\nQC pr_293 — Tesla location config (C1)\n  target: ${resolveBase()}\n`);

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

  // ── 1. Endpoints the page reads (regression; all live) ──
  const cfg = await client.get("/api/admin/config");
  checks.ok(
    "GET /api/admin/config → 200 { variables[] }",
    cfg.status === 200 && Array.isArray(cfg.json?.variables),
    `→ ${cfg.status}`,
  );

  const tesla = await client.get("/api/config/tesla");
  checks.ok(
    "GET /api/config/tesla → 200 (recording flag source)",
    tesla.status === 200 && typeof tesla.json?.telemetryRecordingSetting === "boolean",
    `→ ${tesla.status}`,
  );

  const prop = await client.get("/api/admin/properties");
  checks.ok(
    "GET /api/admin/properties → 200 { property } (use-project-address source)",
    prop.status === 200 && prop.json?.property !== undefined,
    `→ ${prop.status}`,
  );

  // ── 2. New SSR page (200 on preview; pending on prod pre-merge) ──
  await checkPage("/admin/config/tesla", "Tesla Location", "Tesla location config page");

  // ── 3. Config KV write round-trip (PREVIEW ONLY — don't pollute prod config) ──
  if (onProd) {
    checks.info("SKIP: config write probe skipped on prod (would leave a scratch KV key)");
  } else {
    const probeKey = "tesla_location_qc_probe";
    const write = await client.post("/api/admin/config", {
      variables: [{ variableKey: probeKey, valueText: "42", category: "tesla_location", description: "QC probe" }],
    });
    checks.ok("POST /api/admin/config (scratch key) → 200", write.status === 200, `→ ${write.status}`);

    const read = await client.get("/api/admin/config");
    const stored = (read.json?.variables ?? []).find((v) => v.variableKey === probeKey);
    checks.ok("scratch key persisted (round-trip)", stored?.valueText === "42", `→ ${stored?.valueText}`);

    // Blank it out (config KV has no DELETE) so the probe leaves no meaningful value.
    await client.post("/api/admin/config", {
      variables: [{ variableKey: probeKey, valueText: "", category: "tesla_location", description: "QC probe (cleared)" }],
    });
    checks.info("scratch key blanked (config KV has no DELETE; value reset to empty)");
  }
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
