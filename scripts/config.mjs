#!/usr/bin/env node
/**
 * @fileoverview Shared config + HTTP/auth helpers for every QC script.
 *
 * One place that knows the worker base URL and how to authenticate, so a
 * `scripts/qc/pr_##.mjs` never re-derives either. Pairs with tokens.mjs, which
 * reads secrets from the local `tokens` CLI (synced to the Cloudflare secret
 * store — the same values the deployed worker resolves).
 *
 * WHY QC SCRIPTS HIT THE DEPLOYED WORKER, NOT `wrangler dev`: the app's auth
 * secret (`WORKER_API_KEY`) is a `remote: true` secrets-store binding with no
 * local fallback, so every authed route 500s under `wrangler dev`. Local runs
 * therefore cannot verify an API at all — QC targets the deployed worker.
 *
 * Base URL precedence:
 *   --base <url>  →  --preview  →  $BASE_URL  →  WORKER_BASE (production).
 *
 * USE `--preview` WHILE A PR IS OPEN. The default target is PRODUCTION, which
 * runs whatever is on `main` — so QC'ing an unmerged branch against the default
 * silently tests code your branch hasn't shipped yet. That misreads as "my
 * endpoint 404s / my column is missing" when the truth is simply that the
 * branch isn't merged. `--preview` targets this branch's own preview worker
 * (see scripts/deploy-preview.mjs), which is the only URL running your code.
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

import { getToken } from "./tokens.mjs";
import { previewWorkerName } from "./deploy-preview.mjs";

/** Production worker origin (mirrors WORKER_URL in wrangler.jsonc). */
export const WORKER_BASE = "https://core-remodel.hacolby.workers.dev";

/** workers.dev subdomain the previews are published under. */
const WORKERS_DEV_SUBDOMAIN = "hacolby.workers.dev";

/** This branch's preview origin, e.g. core-remodel-preview-claude-foo.…dev. */
export function previewBase(branch) {
  const b =
    branch ||
    process.env.WORKERS_CI_BRANCH ||
    process.env.GITHUB_HEAD_REF ||
    (spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" })
      .stdout || "").trim();
  if (!b) throw new Error("Could not determine the branch for --preview.");
  return `https://${previewWorkerName(b)}.${WORKERS_DEV_SUBDOMAIN}`;
}

/** Resolve the target base URL, honoring --base, --preview and $BASE_URL. */
export function resolveBase(argv = process.argv) {
  const i = argv.indexOf("--base");
  const fromFlag = i !== -1 ? argv[i + 1] : null;
  if (fromFlag) return fromFlag.replace(/\/+$/, "");
  if (argv.includes("--preview")) return previewBase().replace(/\/+$/, "");
  return (process.env.BASE_URL || WORKER_BASE).replace(/\/+$/, "");
}

/**
 * The `remodel_access` cookie the app trusts: SHA-256 hex of the trimmed
 * WORKER_API_KEY (see src/backend/utils/access.ts). Derived directly — no login
 * round-trip. Keep in lock-step with `getAccessCookieHash` there.
 */
export function accessCookie() {
  const key = getToken("WORKER_API_KEY").trim();
  return `remodel_access=${createHash("sha256").update(key).digest("hex")}`;
}

/**
 * Build a client bound to one base URL + auth cookie.
 *
 * `req` never throws on an HTTP status — it returns { status, json, text } so a
 * QC script asserts on status explicitly rather than drowning in try/catch.
 */
export function createClient({ base = resolveBase(), cookie = accessCookie() } = {}) {
  async function req(method, path, { auth = true, body, headers = {} } = {}) {
    const h = { ...headers, ...(auth ? { cookie } : {}) };
    if (body !== undefined) h["content-type"] = "application/json";
    const init = { method, headers: h };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await fetch(`${base}${path}`, init);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* non-JSON (HTML error page, plain text) — leave json null */
    }
    return { status: res.status, json, text };
  }

  return {
    base,
    req,
    get: (path, opts) => req("GET", path, opts),
    post: (path, body, opts) => req("POST", path, { ...opts, body }),
    patch: (path, body, opts) => req("PATCH", path, { ...opts, body }),
  };
}

/**
 * Minimal assertion harness shared by QC scripts, so every PR's output reads
 * the same and the exit code is meaningful in CI.
 */
export function createChecks() {
  const results = [];

  function ok(name, cond, detail = "") {
    results.push({ name, passed: Boolean(cond), detail });
    if (cond) console.log(`  ✓ ${name}`);
    else console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
    return Boolean(cond);
  }

  function info(line) {
    console.log(`    ${line}`);
  }

  function summary() {
    const passed = results.filter((r) => r.passed).length;
    const failed = results.length - passed;
    console.log(`\n${passed} passed, ${failed} failed\n`);
    return { passed, failed, results };
  }

  /** Print the summary and exit non-zero if anything failed. */
  function finish() {
    const { failed } = summary();
    process.exit(failed === 0 ? 0 : 1);
  }

  return { ok, info, summary, finish, results };
}

/** Guard: confirm the target is a core-remodel worker before asserting anything. */
export async function assertReachable(client, checks) {
  const health = await client.get("/api/health", { auth: false });
  const up = checks.ok(
    `target reachable (${client.base})`,
    health.status === 200,
    `GET /api/health → ${health.status}`,
  );
  if (!up) {
    console.log("\nTarget unreachable — every check below would be meaningless. Aborting.\n");
    process.exit(1);
  }
}
