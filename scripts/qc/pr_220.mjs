#!/usr/bin/env node
/**
 * @fileoverview QC — PR #220, location AI (0023 P6): enriched get_vehicle_location
 * + new whats_near_me.
 *
 * Both are OAuth-gated MCP registry tools — they are NOT callable over the legacy
 * `/api/mcp` JSON-RPC shim (that dispatches only a hardcoded legacy subset), and
 * the `/mcp` transport needs an OAuth bearer a QC harness can't mint. So the real,
 * honest wire check is the PUBLIC registry catalog (`GET /api/mcp-docs`): per
 * AGENTS.md a tool with no registry entry, or missing its examples/fields, is a
 * defect. The catalog SSRs the docs page and stays in lockstep with the registry,
 * so asserting the tools' shape here proves the connector exposes them correctly.
 *
 *   pnpm run test:pr 220 -- --preview   # this branch's preview worker (new surface)
 *   pnpm run test:pr 220                 # production — regression guard; the new
 *                                        # tool + enriched fields report PENDING
 *                                        # until this merges and `pnpm run deploy` runs.
 *
 * Live invocation (needs Tessie + OAuth) is verified manually against the preview
 * worker with an MCP client; the deterministic explicit-coords path of
 * whats_near_me is the recommended smoke (no Tessie/Google required).
 */
import {
  assertReachable,
  createChecks,
  createClient,
  resolveBase,
  WORKER_BASE,
} from "../config.mjs";

const client = createClient();
const checks = createChecks();
const onProd = client.base === WORKER_BASE && !process.argv.includes("--preview");

console.log(
  `\nQC pr_220 — location AI (get_vehicle_location enriched + whats_near_me)\n  target: ${resolveBase()}${
    onProd ? " (PROD — new tool + enriched fields report PENDING until merge+deploy)" : ""
  }\n`,
);

await assertReachable(client, checks);

// ── The public registry catalog ──────────────────────────────────────────────
const docs = await client.get("/api/mcp-docs");
const ok = checks.ok(
  "GET /api/mcp-docs → 200 with a tools[] array",
  docs.status === 200 && Array.isArray(docs.json?.tools),
  `→ ${docs.status}`,
);

if (ok) {
  const tools = docs.json.tools;
  const byName = (n) => tools.find((t) => t.name === n);
  const fieldNames = (t) => (t?.outputFields ?? []).map((f) => f.name);
  const inputNames = (t) => (t?.inputFields ?? []).map((f) => f.name);
  const has = (arr, ...names) => names.every((n) => arr.includes(n));

  // ── Regression: the sibling location tool is still registered ──────────────
  checks.ok(
    "get_user_location still in the registry (regression)",
    Boolean(byName("get_user_location")),
    byName("get_user_location") ? "present" : "MISSING",
  );

  // ── P6-MCP-01: get_vehicle_location enrichment ─────────────────────────────
  const gvl = byName("get_vehicle_location");
  checks.ok("get_vehicle_location present", Boolean(gvl), gvl ? "present" : "MISSING");
  if (gvl) {
    const out = fieldNames(gvl);
    const enriched = has(out, "heading", "headingCompass", "address", "region", "serverTime", "ageSeconds", "isStale");
    if (onProd && !enriched) {
      checks.info("PENDING (prod): get_vehicle_location enrichment fields not deployed yet — expected before merge.");
    } else {
      checks.ok(
        "get_vehicle_location exposes the enriched output fields",
        enriched,
        `outputFields=[${out.join(", ")}]`,
      );
    }
    checks.ok("get_vehicle_location has ≥1 example", (gvl.examples?.length ?? 0) >= 1, `examples=${gvl.examples?.length ?? 0}`);
  }

  // ── P6-MCP-02: whats_near_me (new) ─────────────────────────────────────────
  const wnm = byName("whats_near_me");
  if (onProd && !wnm) {
    checks.info("PENDING (prod): whats_near_me not deployed yet — expected before merge.");
  } else {
    checks.ok("whats_near_me present", Boolean(wnm), wnm ? "present" : "MISSING");
    if (wnm) {
      checks.ok("whats_near_me category=showrooms", wnm.category === "showrooms", `→ ${wnm.category}`);
      checks.ok(
        "whats_near_me inputs cover coords + radius + includeUndiscovered",
        has(inputNames(wnm), "latitude", "longitude", "radiusMeters", "includeUndiscovered"),
        `inputFields=[${inputNames(wnm).join(", ")}]`,
      );
      checks.ok(
        "whats_near_me outputs origin/showrooms/undiscovered/note",
        has(fieldNames(wnm), "origin", "showrooms", "undiscovered", "note"),
        `outputFields=[${fieldNames(wnm).join(", ")}]`,
      );
      checks.ok("whats_near_me has ≥1 example", (wnm.examples?.length ?? 0) >= 1, `examples=${wnm.examples?.length ?? 0}`);
    }
  }
}

checks.finish();
