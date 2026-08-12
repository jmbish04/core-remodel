#!/usr/bin/env node
/**
 * @fileoverview QC for the Jules clearance pipeline (0038 Phase B/C).
 *
 * Two layers:
 *   1. LOCAL pure-logic check of `parseClearanceBatchReply` (via tsx) — the
 *      riskiest bit of new logic. Runs anywhere, no worker needed.
 *   2. DEPLOYED checks against the worker: the /sweep kickoff returns a
 *      mode/links/jobId envelope, /sweep/status reads a job (or null), and the
 *      existing GET /api/showroom-sales still returns items (regression guard).
 *
 * Rename to `pr_<number>.mjs` once the PR number exists (per repo convention).
 *
 * Usage:
 *   node scripts/qc/pr_jules_clearance.mjs            # parser check + prod (regression)
 *   node scripts/qc/pr_jules_clearance.mjs --preview  # against this branch's preview
 *   node scripts/qc/pr_jules_clearance.mjs --sweep    # also fire a real kickoff
 */
import { spawnSync } from "node:child_process";

import { createChecks, createClient, assertReachable } from "../config.mjs";

const checks = createChecks();

// ── 1. Local parser assertion (pure logic, no network) ─────────────────────
const parserProbe = `
import { parseClearanceBatchReply } from "./src/backend/services/jules/clearance-prompts.ts";
import assert from "node:assert";

// Bare JSON envelope round-trips to per-link details.
const bare = JSON.stringify({
  results: [
    { linkId: 42, saleHeadline: "Warehouse Sale", saleEndsText: null, summary: "Two floor models.",
      items: [ { title: "Kohler sink", brand: "Kohler", salePrice: 199, originalPrice: 499 } ] },
    { linkId: 7, summary: "Nothing on sale.", items: [] },
  ],
});
const parsed = parseClearanceBatchReply(bare);
assert(parsed && parsed.length === 2, "two results parsed");
const byId = new Map(parsed.map((r) => [r.linkId, r.details]));
assert(byId.get(42).items.length === 1, "item kept");
assert(byId.get(42).items[0].brand === "Kohler", "brand kept");
assert(byId.get(42).items[0].category === null, "missing field defaults null");
assert(byId.get(7).items.length === 0, "empty items survive");

// Fenced / prose-wrapped JSON still parses (defensive slice).
const fenced = "Here you go:\\n\\\`\\\`\\\`json\\n" + bare + "\\n\\\`\\\`\\\`";
assert(parseClearanceBatchReply(fenced)?.length === 2, "fenced JSON parses");

// Garbage returns null (never {}), so the caller falls back instead of blanking.
assert(parseClearanceBatchReply("the vm is still booting") === null, "non-JSON → null");
console.log("PARSER_OK");
`;
const probe = spawnSync("node_modules/.bin/tsx", ["-e", parserProbe], { encoding: "utf8" });
checks.ok(
  "parseClearanceBatchReply: envelope + fenced + null-on-garbage",
  probe.status === 0 && /PARSER_OK/.test(probe.stdout),
  (probe.stderr || probe.stdout || "").trim().split("\n").slice(-3).join(" | "),
);

// Discovery classify: a sitemap URL for an outlet page becomes a WEBSITE_CLEARANCE
// link; a deep product URL and an off-domain URL do not. Reuses the real classifier.
const discoveryProbe = `
import { classifySiteLink } from "./src/backend/services/showroom/social-links.ts";
import assert from "node:assert";
const host = "example.com";
assert(classifySiteLink("https://example.com/outlet", host)?.type === "WEBSITE_CLEARANCE", "outlet landing classifies");
assert(classifySiteLink("https://example.com/clearance/bath", host)?.type === "WEBSITE_CLEARANCE", "clearance section classifies");
assert(classifySiteLink("https://other.com/sale", host) === null, "off-domain rejected");
assert(classifySiteLink("https://example.com/cloudflare-challenges/x/clearance", host) === null, "bot-challenge vetoed");
console.log("DISCOVERY_OK");
`;
const dprobe = spawnSync("node_modules/.bin/tsx", ["-e", discoveryProbe], { encoding: "utf8" });
checks.ok(
  "classifySiteLink: clearance landing yes, deep/off-domain/challenge no",
  dprobe.status === 0 && /DISCOVERY_OK/.test(dprobe.stdout),
  (dprobe.stderr || dprobe.stdout || "").trim().split("\n").slice(-3).join(" | "),
);

// ── 2. Deployed checks ─────────────────────────────────────────────────────
const client = createClient();
console.log(`\nTarget: ${client.base}\n`);
await assertReachable(client, checks);

// Regression: the sales read API still returns items on prod.
const sales = await client.get("/api/showroom-sales");
checks.ok("GET /api/showroom-sales → 200", sales.status === 200, `status ${sales.status}`);
checks.ok(
  "sales response carries an items array",
  sales.status === 200 && Array.isArray(sales.json?.items ?? sales.json),
  "no items[] in response",
);

// Status endpoint returns the { ok, job } envelope (job may be null). A 404
// against prod pre-merge is EXPECTED (new route) — report pending, don't fail.
const status = await client.get("/api/showroom-sales/sweep/status");
if (status.status === 404) {
  checks.info("GET /api/showroom-sales/sweep/status → 404: pending merge/deploy (new route)");
} else {
  checks.ok(
    "GET /api/showroom-sales/sweep/status → { ok, job }",
    status.status === 200 && typeof status.json?.ok === "boolean",
    `status ${status.status}`,
  );
}

// Opt-in: run real link discovery against the deployed worker (plain fetch, no
// spend). Reports how many new clearance links it registered.
if (process.argv.includes("--discover")) {
  const disc = await client.post("/api/showroom-sales/discover", { limit: 500 });
  checks.ok(
    "POST /discover → summary",
    disc.status === 200 && typeof disc.json?.newLinks === "number",
    JSON.stringify(disc.json),
  );
  if (disc.json)
    checks.info(
      `discovered ${disc.json.newLinks} new links across ${disc.json.storesScanned} stores`,
    );
}

// Opt-in: actually fire a Jules kickoff (spends a Jules session). Off by default.
if (process.argv.includes("--sweep")) {
  const kick = await client.post("/api/showroom-sales/sweep", { limit: 3 });
  checks.ok(
    "POST /sweep kicks off (mode jules|fallback)",
    kick.status === 200 && (kick.json?.mode === "jules" || kick.json?.mode === "fallback"),
    JSON.stringify(kick.json),
  );
  if (kick.json?.jobId)
    checks.info(`job ${kick.json.jobId} — poll /sweep/status?jobId=${kick.json.jobId}`);
}

checks.finish();
