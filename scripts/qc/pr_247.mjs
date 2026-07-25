#!/usr/bin/env node
/**
 * @fileoverview QC — PR #247, drive-list streaming toggle + status pill (0023 PR3).
 *
 * Frontend-only PR, so this is a regression guard: the Showroom Drives page still
 * serves, and the two endpoints the widget reads (/stream/control, /stream/status)
 * are reachable and shaped the way TeslaStreamControl.tsx consumes them. Read-only.
 *
 *   pnpm run test:pr 247 -- --preview
 *   pnpm run test:pr 247
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(`\nQC pr_247 — drive-list stream control UI\n  target: ${resolveBase()}\n`);

await assertReachable(client, checks);

// ── The drives page still serves (the island mounts here) ────────────────────
const page = await client.get("/admin/shopping/drives");
checks.ok(
  "GET /admin/shopping/drives → 200 HTML (page serves)",
  page.status === 200,
  `→ ${page.status}`,
);

// ── The endpoints the widget reads, in the shape it expects ──────────────────
const control = await client.get("/api/tesla/stream/control");
if (onProd && control.status === 404) {
  checks.info("PENDING: /api/tesla/stream/control not on prod yet (pending #241/#242 deploy)");
} else {
  checks.ok(
    "GET /api/tesla/stream/control → control{enabled,windowStartHour,windowEndHour,pollFallbackSeconds} + shouldStream/shouldPoll",
    control.status === 200 &&
      typeof control.json?.control?.enabled === "boolean" &&
      typeof control.json?.control?.windowStartHour === "number" &&
      typeof control.json?.control?.pollFallbackSeconds === "number" &&
      typeof control.json?.shouldStream === "boolean" &&
      typeof control.json?.shouldPoll === "boolean",
    `→ ${control.status}`,
  );
}

const status = await client.get("/api/tesla/stream/status");
if (onProd && status.status === 404) {
  checks.info("PENDING: /api/tesla/stream/status not on prod yet");
} else {
  checks.ok(
    "GET /api/tesla/stream/status → { connected, breaker.tripped }",
    status.status === 200 &&
      typeof status.json?.connected === "boolean" &&
      typeof status.json?.breaker?.tripped === "boolean",
    `→ ${status.status}`,
  );
}

checks.finish();
