#!/usr/bin/env node
/**
 * preview-cleanup.mjs — find and delete ORPHANED preview workers.
 *
 * An orphan is a preview whose branch no longer exists on origin (merged or
 * abandoned). Nothing reaps them automatically, so this is the sweep an agent
 * runs when it finishes a piece of work.
 *
 * SAFETY MODEL — the ledger is an allowlist, not a hint:
 *   1. Only workers recorded in the preview ledger are candidates. A worker
 *      that merely LOOKS like a preview is never touched, because this tooling
 *      cannot prove it created it.
 *   2. `assertDeletable` re-checks every name at the point of deletion (in
 *      ledger, correct prefix, not production).
 *   3. Nothing is deleted without `--apply`. The default is a report.
 * The account has 184 workers on it. "Enumerate and pattern-match" would be one
 * bad regex away from deleting something that matters; the ledger removes that
 * class of mistake entirely.
 *
 * The API is consulted only to answer "does it still exist?", so a preview that
 * was already deleted by hand is reported as stale-ledger rather than re-deleted.
 *
 * Run:  pnpm run preview:cleanup            # report only
 *       pnpm run preview:cleanup -- --apply # delete the orphans
 */

import { spawnSync } from "node:child_process";

import { getToken } from "./tokens.mjs";
import { assertDeletable, forgetPreview, readLedger } from "./preview-ledger.mjs";

const APPLY = process.argv.includes("--apply");

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/**
 * Live worker names on the account.
 *
 * `wrangler` has no command that lists an account's Workers, so this uses the
 * REST API. `CLOUDFLARE_API_TOKEN` is NOT the one with Workers scope here —
 * `CLOUDFLARE_EDIT_WORKERS_API_TOKEN` is, with `CLOUDFLARE_WRANGLER_API_TOKEN`
 * as the fallback.
 *
 * These used to be bundled inside one JSON blob under `CLOUDFLARE_API_TOKEN`;
 * they are now separate entries in the tokens store. Both shapes are handled,
 * because assuming either one silently broke the orphan sweep — the failure
 * mode is preview workers quietly accumulating on an account that already
 * carries ~184 of them.
 */
/**
 * The Workers-scoped token, from separate store entries or the legacy JSON blob.
 * Never interpolate the value into an error — a credential must not reach a log.
 */
function workersScopedToken() {
  for (const name of ["CLOUDFLARE_EDIT_WORKERS_API_TOKEN", "CLOUDFLARE_WRANGLER_API_TOKEN"]) {
    try {
      const value = getToken(name).trim();
      if (value && !value.startsWith("{")) return value;
    } catch {
      // Not in the store under this name — try the next.
    }
  }
  // Legacy shape: one JSON blob under CLOUDFLARE_API_TOKEN.
  try {
    const raw = getToken("CLOUDFLARE_API_TOKEN").trim();
    if (raw.startsWith("{")) {
      const blob = JSON.parse(raw);
      return blob.CLOUDFLARE_EDIT_WORKERS_API_TOKEN ?? blob.CLOUDFLARE_WRANGLER_API_TOKEN ?? null;
    }
  } catch {
    // Fall through to the caller's error.
  }
  return null;
}

async function liveWorkerNames() {
  // Parse defensively: `getToken` will hand back a bare token string if
  // CLOUDFLARE_API_TOKEN happens to be exported in the shell (as it is during a
  // manual `wrangler` session), and the raw JSON.parse error echoes that token
  // into the log. Never put a credential in an error message.
  const token = workersScopedToken();
  if (!token) {
    throw new Error(
      "No Workers-scoped Cloudflare token available. Expected " +
        "CLOUDFLARE_EDIT_WORKERS_API_TOKEN or CLOUDFLARE_WRANGLER_API_TOKEN in " +
        "the tokens store.",
    );
  }
  const accountId = getToken("CLOUDFLARE_ACCOUNT_ID").trim();

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const payload = await res.json();
  if (!payload.success) throw new Error(`Listing workers failed: ${JSON.stringify(payload.errors)}`);
  return new Set((payload.result || []).map((w) => w.id));
}

const ledger = readLedger();
if (ledger.length === 0) {
  console.log("\nPreview ledger is empty — nothing this tooling created.\n");
  process.exit(0);
}

sh("git", ["fetch", "--prune", "--quiet", "origin"]);
const liveBranches = new Set(
  sh("git", ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"])
    .split("\n")
    .map((s) => s.trim().replace(/^origin\//, ""))
    .filter(Boolean),
);

const live = await liveWorkerNames();

const orphans = [];
const staleEntries = [];
const keep = [];
for (const entry of ledger) {
  if (!live.has(entry.worker)) staleEntries.push(entry);
  else if (!liveBranches.has(entry.branch)) orphans.push(entry);
  else keep.push(entry);
}

console.log(`\nPreview ledger: ${ledger.length} recorded`);
console.log(`  ${keep.length} active (branch still on origin)`);
console.log(`  ${orphans.length} orphaned (branch gone)`);
console.log(`  ${staleEntries.length} already deleted (ledger out of date)\n`);

for (const e of keep) console.log(`  keep    ${e.worker}  ← ${e.branch}`);
for (const e of orphans) console.log(`  ORPHAN  ${e.worker}  ← ${e.branch} (branch gone)`);
for (const e of staleEntries) console.log(`  gone    ${e.worker}  (already deleted)`);

// A ledger entry whose worker no longer exists is just bookkeeping — prune it
// without touching Cloudflare.
for (const e of staleEntries) forgetPreview(e.worker);
if (staleEntries.length) console.log(`\nPruned ${staleEntries.length} stale ledger entr(ies).`);

if (orphans.length === 0) {
  console.log("\nNo orphans to delete.\n");
  process.exit(0);
}

if (!APPLY) {
  console.log("\nReport only — re-run with `-- --apply` to delete the orphans.\n");
  process.exit(0);
}

let failed = 0;
for (const e of orphans) {
  try {
    assertDeletable(e.worker); // belt and braces — re-check at the point of deletion
  } catch (err) {
    console.error(`  skip    ${e.worker}: ${err.message}`);
    failed += 1;
    continue;
  }
  const r = spawnSync("npx", ["wrangler@latest", "delete", "--name", e.worker], {
    stdio: "inherit",
  });
  if ((r.status ?? 0) === 0) forgetPreview(e.worker);
  else failed += 1;
}

console.log(`\nDeleted ${orphans.length - failed}/${orphans.length} orphaned previews.\n`);
process.exit(failed > 0 ? 1 : 0);
