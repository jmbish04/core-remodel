#!/usr/bin/env node
/**
 * Runner for the Showroom Scout live smoke test.
 *
 * Reads secrets from the `tokens` CLI (same values the deployed worker's
 * secrets-store bindings resolve), injects them into the environment, then
 * builds and runs the bundled harness.
 *
 * Secrets are injected rather than imported because bundling `tokens.mjs` trips
 * its CLI main-guard.
 *
 * COSTS REAL MONEY — a handful of Gemini calls per run. Not part of CI.
 *
 * Usage:
 *   node scripts/tests/run_scout_smoke.mjs
 *   SCOUT_GOAL="find tile showrooms in Marin" node scripts/tests/run_scout_smoke.mjs
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { getToken } from "../tokens.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const gemini = getToken("GEMINI_API_KEY", { optional: true });
if (!gemini) {
  console.error("GEMINI_API_KEY unavailable via the `tokens` CLI — authenticate it first.");
  process.exit(1);
}
process.env.GEMINI_API_KEY = gemini;

// Optional: enables the real traffic-aware route matrix. Absent is fine — the
// planner degrades to estimates, which is itself worth observing.
const maps = getToken("GOOGLE_MAPS_API", { optional: true });
if (maps) process.env.GOOGLE_MAPS_API = maps;
console.log(`secrets: GEMINI_API_KEY ok, GOOGLE_MAPS_API ${maps ? "ok" : "absent (will degrade)"}`);

execFileSync("node", [path.join(here, "build_scout_smoke.mjs")], { stdio: "inherit" });

await import(pathToFileURL(path.join(root, "node_modules/.cache/scout-smoke/run.mjs")).href);
