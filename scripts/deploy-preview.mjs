#!/usr/bin/env node
/**
 * deploy-preview.mjs — deploy the current build to the dedicated PREVIEW worker.
 *
 * Why a second worker instead of `wrangler versions upload` preview URLs:
 * version preview URLs are not served for Workers that implement Durable
 * Objects (core-remodel exports twelve), so `versions upload` gives safety but
 * no viewable URL. Deploying to a separate worker (`core-remodel-preview`)
 * gives a stable URL — https://core-remodel-preview-<branch>.<subdomain>.workers.dev —
 * with the SAME D1/R2/KV/Vectorize/AI/secrets bindings (shared by id) and its
 * own fresh Durable Object namespaces.
 *
 * The preview config is derived from wrangler.jsonc with:
 *   - `name` → core-remodel-preview-<branch-slug>
 *   - `triggers` (crons) REMOVED — otherwise scheduled jobs (permit sync,
 *     gmail ingestion, master tick) would run TWICE against the shared D1.
 *   - `routes` / custom domains REMOVED — workers.dev only.
 *
 * ONE PREVIEW WORKER PER BRANCH. This repo is worked by several concurrent
 * agentic sessions, and a single shared preview slot just relocates the race
 * that used to hit production — whoever pushed last owned the URL, so "I
 * verified it on the deployed worker" was only true until the next push. The
 * worker is therefore named `core-remodel-preview-<branch-slug>` and each
 * branch gets its own stable URL, its own Durable Object namespaces (so branch
 * DO migration tags can't desync prod's) and its own Workflow instances.
 *
 * Branch resolution: WORKERS_CI_BRANCH (Workers Builds) → GITHUB_HEAD_REF /
 * GITHUB_REF_NAME (Actions) → the local git branch. `main` is rejected — main
 * deploys to production through `pnpm run deploy`, not here.
 *
 * Run via `pnpm run deploy:preview` (locally) or the Workers Builds
 * non-production trigger. NOTE: previews share prod's D1 — a branch with new
 * migrations needs `pnpm run migrate:remote` (additive-only discipline) for
 * its pages to work.
 *
 * Preview workers accumulate; `pnpm run preview:cleanup` deletes the ones whose
 * branch no longer exists on origin.
 */

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SOURCE = "wrangler.jsonc";
const DERIVED = ".wrangler-preview.json";
const PREFIX = "core-remodel-preview";

/** Workers script names: [a-z0-9-], 63 chars max. */
export function slugifyBranch(branch) {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/**
 * `core-remodel-preview-<slug>`, capped at the 63-char script-name limit.
 *
 * Truncation keeps the TAIL of the slug, not the head: our branches are
 * `claude/<topic>-<hash>`, so the distinguishing part is at the end and
 * head-truncation would collide every long branch onto one name.
 */
export function previewWorkerName(branch) {
  const slug = slugifyBranch(branch);
  const budget = 63 - PREFIX.length - 1;
  const tail = slug.length > budget ? slug.slice(slug.length - budget) : slug;
  return `${PREFIX}-${tail.replace(/^-+/, "")}`;
}

function currentBranch() {
  const fromEnv =
    process.env.WORKERS_CI_BRANCH ||
    process.env.GITHUB_HEAD_REF ||
    process.env.GITHUB_REF_NAME;
  if (fromEnv) return fromEnv;
  const git = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    encoding: "utf8",
  });
  return (git.stdout || "").trim();
}

// Everything below is the deploy itself. Guarded behind an entry-point check
// because preview-cleanup.mjs imports `previewWorkerName` from this file —
// without the guard, importing the helper would deploy a worker.
const isEntryPoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const branch = currentBranch();
  if (!branch) {
    console.error("Could not determine the branch — set WORKERS_CI_BRANCH.");
    process.exit(1);
  }
  if (branch === "main" || branch === "HEAD") {
    console.error(
      `Refusing to deploy a preview for "${branch}" — main ships to production via \`pnpm run deploy\`.`,
    );
    process.exit(1);
  }

  const PREVIEW_NAME = previewWorkerName(branch);

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
  // deployer). Suffix per BRANCH, not just "-preview" — with one preview worker
  // per branch, a shared "-preview" suffix would put every branch back in the
  // same fight, just one level down. Workflow names cap at 64 chars.
  if (Array.isArray(config.workflows)) {
    const suffix = previewWorkerName(branch).slice(PREFIX.length); // "-<slug>"
    for (const wf of config.workflows) {
      if (!wf?.name) continue;
      const budget = 64 - suffix.length;
      wf.name = `${wf.name.slice(0, budget)}${suffix}`;
    }
  }

  writeFileSync(DERIVED, JSON.stringify(config, null, 2));

  console.log(
    `\n▶ Deploying preview worker "${PREVIEW_NAME}" for branch "${branch}" (crons/routes stripped)…\n`,
  );
  const res = spawnSync(
    "npx",
    ["wrangler@latest", "deploy", "-c", DERIVED],
    { stdio: "inherit" },
  );
  rmSync(DERIVED, { force: true });

  if (res.status !== 0) process.exit(res.status ?? 1);

  // Printed so the Workers Builds log carries the URL a reviewer (or the next
  // agent session) needs, without opening the dashboard.
  console.log(`\n✅ Preview URL: https://${PREVIEW_NAME}.hacolby.workers.dev\n`);

}
