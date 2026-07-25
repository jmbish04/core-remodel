#!/usr/bin/env node
/**
 * @fileoverview QC — PR #200, 0028 P1 (component layer, first slice).
 *
 *   pnpm run test:pr 200 -- --preview   # this branch's preview worker
 *   pnpm run test:pr 200                # production — page PENDING until deploy
 *
 * This slice is frontend-only (atoms, WorkItemCard, WorkBoard, the gallery) with
 * no schema change and no new API, so the observable surface is the gallery page
 * rendering and mounting its island. The pure logic has its own runnable check
 * (scripts/checks/pmo-tone.check.ts, run in CI-style locally).
 */
import { createClient, createChecks, assertReachable, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(
  `\nQC pr_200 — 0028 P1 components\n  target: ${resolveBase()}${
    onProd ? " (PROD — gallery PENDING until merge+deploy)" : ""
  }\n`,
);

await assertReachable(client, checks);

const page = await client.get("/admin/pmo/components");
if (onProd && page.status !== 200) {
  checks.info("PENDING (prod): /admin/pmo/components not deployed yet.");
} else {
  checks.ok("GET /admin/pmo/components → 200", page.status === 200, `→ ${page.status}`);
  checks.ok("page mounts the gallery island", page.text.includes("PmoGalleryApp"));
  checks.ok("shell follows the studio pattern (container header)", page.text.includes("PMO Components"));
}

// The API foundation the components will consume is already live (P0). Guard it.
const api = await client.get("/api/pmo/work-items?source=plan&container=0028_project_management");
checks.ok(
  "P0 /api/pmo/work-items still serves (regression)",
  api.status === 200 && Array.isArray(api.json?.items),
  `→ ${api.status}`,
);

const unauth = await client.get("/admin/pmo/components", { auth: false });
checks.ok(
  "gallery is gated (no PmoGalleryApp for an unauthenticated caller)",
  !unauth.text.includes("PmoGalleryApp"),
  `→ ${unauth.status}`,
);

checks.finish();
