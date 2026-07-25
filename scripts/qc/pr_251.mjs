#!/usr/bin/env node
/**
 * @fileoverview QC — PR #251, global admin telemetry alert + vehicle image (0023).
 *
 * Asserts the aggregate banner endpoint the global alert reads, plus a regression
 * that admin pages still serve. Read-only.
 *
 *   pnpm run test:pr 251 -- --preview
 *   pnpm run test:pr 251
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(`\nQC pr_251 — global admin telemetry alert\n  target: ${resolveBase()}\n`);

await assertReachable(client, checks);

try {
  // ── The banner aggregate the global alert consumes ─────────────────────────
  const banner = await client.get("/api/tesla/stream/banner");
  if (onProd && banner.status === 404) {
    checks.info("PENDING: /api/tesla/stream/banner not on prod yet (pending merge+deploy)");
  } else {
    const j = banner.json ?? {};
    checks.ok(
      "GET /api/tesla/stream/banner → 200 with the full banner contract",
      banner.status === 200 &&
        ("activeDrive" in j) && // nullable object
        typeof j.telemetryActive === "boolean" &&
        typeof j.telemetryEnabled === "boolean" &&
        typeof j.withinWindow === "boolean" &&
        typeof j.canEnable === "boolean" &&
        typeof j.windowLabel === "string" &&
        ("vehicleImageUrl" in j),
      `→ ${banner.status} ${JSON.stringify(j)}`,
    );

    if (banner.status === 200) {
      // The window label is 12-hour (contains AM/PM), per the spec.
      checks.ok(
        "windowLabel is a 12-hour range (AM/PM)",
        /\bAM\b|\bPM\b/.test(j.windowLabel ?? ""),
        `windowLabel=${j.windowLabel}`,
      );
      // Invariant: an Enable button only offered when a drive is active, in-window,
      // and telemetry isn't already enabled.
      checks.ok(
        "canEnable implies activeDrive ∧ withinWindow ∧ !telemetryEnabled",
        !j.canEnable || (j.activeDrive && j.withinWindow && !j.telemetryEnabled),
        `canEnable=${j.canEnable} active=${!!j.activeDrive} inWindow=${j.withinWindow} enabled=${j.telemetryEnabled}`,
      );
      // A vehicle image is only present when telemetry is live.
      checks.ok(
        "vehicleImageUrl only set when telemetry is active",
        !j.vehicleImageUrl || j.telemetryActive === true,
        `img=${j.vehicleImageUrl ? "set" : "null"} active=${j.telemetryActive}`,
      );
    }
  }

  // ── Regression: an admin page still serves the layout the banner mounts in ──
  const page = await client.get("/admin/shopping/drives");
  checks.ok(
    "GET /admin/shopping/drives → 200 HTML (BaseLayout renders)",
    page.status === 200 && page.json === null && /<!doctype html|<html/i.test(page.text ?? ""),
    `→ ${page.status}`,
  );
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
