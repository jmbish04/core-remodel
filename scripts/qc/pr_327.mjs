#!/usr/bin/env node
/**
 * @fileoverview QC — PR #327, 0032 D2c-2: discovery-finder MCP tools.
 *
 * 10 MCP tools (find_showrooms + slug actions + exclusion tools) — thin defineTool
 * wrappers over the SAME services/showroom/discovery-search.ts functions the D2c-1 REST
 * routes call (parity). The tools themselves are OAuth-gated, but the registry is exposed
 * publicly via GET /api/mcp-docs (which backs the /connect/tools catalog), so this QC
 * proves all 10 are registered + catalogued.
 *
 *   pnpm run test:pr 327 -- --preview
 *   pnpm run test:pr 327
 */
import { assertReachable, createChecks, createClient, resolveBase, WORKER_BASE } from "../config.mjs";

const client = createClient();
const checks = createChecks();
const isPreview = client.base !== WORKER_BASE;

const EXPECTED = [
  "find_showrooms",
  "list_showroom_searches",
  "get_showroom_search",
  "get_search_revisions",
  "finalize_showroom_search",
  "import_search_results",
  "exclude_search_result",
  "add_showroom_exclusion",
  "list_showroom_exclusions",
  "remove_showroom_exclusion",
];

console.log(`\nQC pr_327 — discovery MCP tools (D2c-2)\n  target: ${resolveBase()} ${isPreview ? "(preview)" : "(production)"}\n`);

try {
  await assertReachable(client, checks);

  const docs = await client.get("/api/mcp-docs");
  checks.ok("GET /api/mcp-docs → 200 (MCP catalog)", docs.status === 200, `→ ${docs.status}`);

  // createClient().get returns { status, json (parsed), text (string) }. Prefer the
  // raw text; fall back to the parsed json stringified. No swallowed error.
  const text =
    typeof docs.text === "string" && docs.text.length > 0
      ? docs.text
      : docs.json != null
        ? JSON.stringify(docs.json)
        : "";

  if (docs.status === 200) {
    for (const name of EXPECTED) {
      checks.ok(`MCP catalog includes '${name}'`, text.includes(`"${name}"`) || text.includes(name), "");
    }
  } else {
    checks.info(`MCP catalog not reachable here (${docs.status}) — tools verified via tsc + registry on prod after deploy.`);
  }

  checks.info(
    "All 10 tools are thin defineTool wrappers over discovery-search.ts (the D2c-1 service) — REST/MCP parity. Invoking them needs an OAuth grant (not mintable in QC); the registry catalog presence is the wired-in proof, and the /connect/tools card auto-renders from it.",
  );
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
