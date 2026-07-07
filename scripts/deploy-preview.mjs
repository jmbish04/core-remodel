#!/usr/bin/env node
/**
 * deploy-preview.mjs — deploy the current build to the dedicated PREVIEW worker.
 *
 * Why a second worker instead of `wrangler versions upload` preview URLs:
 * version preview URLs are not served for Workers that implement Durable
 * Objects (core-remodel exports twelve), so `versions upload` gives safety but
 * no viewable URL. Deploying to a separate worker (`core-remodel-preview`)
 * gives a stable URL — https://core-remodel-preview.<subdomain>.workers.dev —
 * with the SAME D1/R2/KV/Vectorize/AI/secrets bindings (shared by id) and its
 * own fresh Durable Object namespaces.
 *
 * The preview config is derived from wrangler.jsonc with:
 *   - `name` → core-remodel-preview
 *   - `triggers` (crons) REMOVED — otherwise scheduled jobs (permit sync,
 *     gmail ingestion, master tick) would run TWICE against the shared D1.
 *   - `routes` / custom domains REMOVED — workers.dev only.
 *
 * One preview slot: the last branch deployed wins. Run via
 * `pnpm run deploy:preview` (locally) or the Workers Builds non-production
 * trigger. NOTE: previews share prod's D1 — a branch with new migrations needs
 * `pnpm run migrate:remote` (additive-only discipline) for its pages to work.
 */

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const PREVIEW_NAME = "core-remodel-preview";
const SOURCE = "wrangler.jsonc";
const DERIVED = ".wrangler-preview.json";

/**
 * Strip JSONC comments without corrupting string contents (e.g. "https://…").
 * Walks the source tracking in-string state; removes // line comments and
 * /* block comments *\/ only outside strings.
 */
function stripJsonComments(input) {
  let out = "";
  let inString = false;
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      }
      continue;
    }
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === "\\") {
        // keep the escaped char verbatim and skip its terminator handling
        out += next ?? "";
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLine = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      i++;
      continue;
    }
    out += ch;
  }
  // JSONC allows trailing commas; JSON.parse does not.
  return out.replace(/,(\s*[}\]])/g, "$1");
}

const raw = readFileSync(SOURCE, "utf8");
const config = JSON.parse(stripJsonComments(raw));

config.name = PREVIEW_NAME;
delete config.triggers; // no crons on preview — they'd double-run against shared D1
delete config.routes; // workers.dev only
delete config.route;

// Workflows are ACCOUNT-scoped by name: deploying the same names from a second
// worker HIJACKS the prod bindings (name -> script mapping follows the last
// deployer). Suffix every workflow name so preview gets its own instances.
if (Array.isArray(config.workflows)) {
  for (const wf of config.workflows) {
    if (wf?.name && !wf.name.endsWith("-preview")) wf.name = `${wf.name}-preview`;
  }
}

writeFileSync(DERIVED, JSON.stringify(config, null, 2));

console.log(`\n▶ Deploying preview worker "${PREVIEW_NAME}" (crons/routes stripped)…\n`);
const res = spawnSync(
  "npx",
  ["wrangler@latest", "deploy", "-c", DERIVED],
  { stdio: "inherit" },
);
rmSync(DERIVED, { force: true });

if (res.status !== 0) process.exit(res.status ?? 1);

console.log(`\n✅ Preview live: https://${PREVIEW_NAME}.hacolby.workers.dev\n`);
