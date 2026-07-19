#!/usr/bin/env node
/**
 * preview-ledger.mjs — the record of preview workers this tooling created.
 *
 * WHY A LEDGER AND NOT "LIST THE ACCOUNT'S WORKERS AND MATCH A PREFIX":
 * the ledger is an ALLOWLIST. Cleanup may only delete a worker it can prove
 * this tooling created. Enumerating the account and deleting everything that
 * looks like `wcrp-*` would put an agent one bad regex — or one coincidentally
 * named worker — away from deleting something that matters. The account has 184
 * workers on it. Deletion is not a thing to be clever about.
 *
 * The ledger therefore answers "what may I delete?"; the API is consulted only
 * to answer "does it still exist?".
 *
 * WHERE IT LIVES: the git COMMON dir (`git rev-parse --git-common-dir`), which
 * is the main repo's `.git` and is shared by every worktree on this machine.
 * So all concurrent sessions read and write one ledger, and because it is not
 * inside the working tree it is never committed and never conflicts on merge.
 *
 * FAILURE DIRECTION: if a preview was created on another machine, it is absent
 * here and simply will not be auto-cleaned. The ledger can only ever be too
 * conservative, never destructive — which is the correct way for it to be wrong.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** Prefix for every preview worker. Short on purpose — see previewWorkerName. */
export const PREFIX = "wcrp";

function ledgerPath() {
  const r = spawnSync("git", ["rev-parse", "--git-common-dir"], { encoding: "utf8" });
  const dir = (r.stdout || "").trim();
  if (!dir) throw new Error("Not a git checkout — cannot locate the preview ledger.");
  return join(dir, "preview-workers.json");
}

/** Every recorded preview: [{ worker, branch, createdAt, worktree }]. */
export function readLedger() {
  const p = ledgerPath();
  if (!existsSync(p)) return [];
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A corrupt ledger must not authorize deletions — treat it as empty.
    console.warn(`[preview-ledger] ${p} is unreadable; treating as empty.`);
    return [];
  }
}

function writeLedger(entries) {
  writeFileSync(ledgerPath(), `${JSON.stringify(entries, null, 2)}\n`);
}

/** Record a deploy. Idempotent per worker name — re-deploying refreshes it. */
export function recordPreview({ worker, branch }) {
  const entries = readLedger().filter((e) => e.worker !== worker);
  entries.push({
    worker,
    branch,
    createdAt: new Date().toISOString(),
    worktree: process.cwd(),
  });
  writeLedger(entries);
  return entries.length;
}

/** Drop a worker from the ledger (call after a successful delete). */
export function forgetPreview(worker) {
  writeLedger(readLedger().filter((e) => e.worker !== worker));
}

/**
 * Guard every delete goes through. Returns the ledger entry, or throws.
 *
 * Refuses anything not recorded here, anything without the preview prefix, and
 * the production worker by name — three independent checks, because the cost of
 * a false positive is someone's Worker.
 */
export function assertDeletable(worker) {
  if (!worker || typeof worker !== "string") {
    throw new Error("No worker name given.");
  }
  if (worker === "core-remodel") {
    throw new Error("Refusing to delete the production worker.");
  }
  if (!worker.startsWith(`${PREFIX}-`)) {
    throw new Error(`Refusing to delete "${worker}" — not a ${PREFIX}- preview worker.`);
  }
  const entry = readLedger().find((e) => e.worker === worker);
  if (!entry) {
    throw new Error(
      `Refusing to delete "${worker}" — it is not in the preview ledger, so this ` +
        `tooling did not create it. Delete it by hand if you are certain: ` +
        `npx wrangler delete --name ${worker}`,
    );
  }
  return entry;
}
