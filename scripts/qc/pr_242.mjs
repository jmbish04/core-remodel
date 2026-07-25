#!/usr/bin/env node
/**
 * @fileoverview QC — PR #242, TeslaStreamDO (0023 ING-02/ING-04).
 *
 * READ-ONLY by design. It asserts the DO status contract and the control
 * round-trip, but NEVER calls `POST /api/tesla/stream/start` — that would open a
 * real outbound Tessie socket (a live side effect + billing), which is exactly
 * what this feature is careful about. Live connect/disconnect is smoke-tested
 * manually against the preview worker with Tessie configured.
 *
 *   pnpm run test:pr 242 -- --preview   # this branch's preview worker (new surface)
 *   pnpm run test:pr 242                 # production — regression + PENDING report
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(
  `\nQC pr_242 — TeslaStreamDO status + control\n  target: ${resolveBase()}${
    onProd ? " (PROD — new routes report PENDING until merge+deploy)" : ""
  }\n`,
);

await assertReachable(client, checks);

// ── The DO status contract (read-only; safe on any target) ───────────────────
const status = await client.get("/api/tesla/stream/status");
if (onProd && status.status === 404) {
  checks.info("PENDING: GET /api/tesla/stream/status not on prod yet (pending merge+deploy)");
} else {
  checks.ok(
    "GET /api/tesla/stream/status → 200 with the DO status contract",
    status.status === 200 &&
      status.json &&
      typeof status.json.connected === "boolean" &&
      "writesToday" in status.json &&
      status.json.breaker &&
      typeof status.json.breaker.tripped === "boolean",
    `→ ${status.status} ${JSON.stringify(status.json)}`,
  );

  // A fresh/idle DO must not report a tripped breaker or a held socket during QC.
  if (status.status === 200) {
    checks.ok(
      "idle DO: breaker not tripped",
      status.json.breaker?.tripped === false,
      `breaker=${JSON.stringify(status.json.breaker)}`,
    );
  }
}

// ── Regression: the ING-03 control surface still answers ─────────────────────
const control = await client.get("/api/tesla/stream/control");
if (onProd && control.status === 404) {
  checks.info("PENDING: GET /api/tesla/stream/control not on prod yet");
} else {
  checks.ok(
    "GET /api/tesla/stream/control → 200 (regression)",
    control.status === 200 && typeof control.json?.control?.enabled === "boolean",
    `→ ${control.status}`,
  );
  // The KV-TTL floor fix: the reported cadence must be ≥ 60.
  if (control.status === 200) {
    checks.ok(
      "poll fallback cadence is floored at 60s",
      control.json.control.pollFallbackSeconds >= 60,
      `pollFallbackSeconds=${control.json.control.pollFallbackSeconds}`,
    );
  }
}

checks.finish();
