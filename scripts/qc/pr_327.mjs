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

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Collect every `name` string field in the catalog (the tool identifiers), recursively. */
function collectToolNames(node, out = new Set()) {
  if (node == null || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectToolNames(item, out);
    return out;
  }
  if (typeof node.name === "string") out.add(node.name);
  for (const v of Object.values(node)) collectToolNames(v, out);
  return out;
}

try {
  await assertReachable(client, checks);

  const docs = await client.get("/api/mcp-docs");
  checks.ok("GET /api/mcp-docs → 200 (MCP catalog)", docs.status === 200, `→ ${docs.status}`);

  // createClient().get returns { status, json (parsed), text (string) }. Parse the
  // catalog and assert membership in the REAL tool-name set — not a loose substring
  // match (which a description or another tool name could satisfy).
  const catalog = docs.json ?? (docs.text ? safeJson(docs.text) : null);
  const toolNames = new Set(collectToolNames(catalog));

  if (docs.status === 200 && toolNames.size > 0) {
    for (const name of EXPECTED) {
      checks.ok(`MCP catalog registers '${name}'`, toolNames.has(name), toolNames.has(name) ? "" : "absent");
    }
  } else if (!isPreview) {
    // On prod (post-deploy) the catalog MUST be live + parseable — a skip would let QC
    // pass green while the tools aren't actually catalogued. Fail loudly.
    checks.ok(
      "MCP catalog reachable + parseable on production",
      false,
      `status=${docs.status}, tool-names parsed=${toolNames.size}`,
    );
  } else {
    checks.info(`MCP catalog not reachable on this preview target (${docs.status}) — verified on prod post-deploy.`);
  }

  checks.info(
    "All 10 tools are thin defineTool wrappers over discovery-search.ts (the D2c-1 service) — REST/MCP parity. Invoking them needs an OAuth grant (not mintable in QC); the registry catalog presence is the wired-in proof, and the /connect/tools card auto-renders from it.",
  );
} catch (err) {
  checks.ok("QC completed without an unhandled error", false, (err && err.message) || String(err));
}

checks.finish();
