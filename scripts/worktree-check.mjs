#!/usr/bin/env node
/**
 * worktree-check.mjs — how stale is this checkout, answered BEFORE any work.
 *
 * The failure this exists to stop: a session opens a reused worktree that is
 * 50+ commits behind `main`, reads code that was rewritten weeks ago, and
 * concludes a shipped feature is "missing" — burning a lot of tokens before
 * anyone notices the checkout was old. That conclusion is unrecoverable by
 * reasoning; the only fix is to look at the ref count first.
 *
 * Wired to the SessionStart hook in .claude/settings.json so it runs before the
 * agent reads anything. Also runnable by hand:  node scripts/worktree-check.mjs
 *
 * Exit code is always 0 — this informs, it does not block. A stale worktree is
 * legitimate when you are deliberately revisiting an old branch.
 */

import { spawnSync } from "node:child_process";

const git = (...args) => {
  const r = spawnSync("git", args, { encoding: "utf8" });
  return r.status === 0 ? (r.stdout || "").trim() : null;
};

const branch = git("rev-parse", "--abbrev-ref", "HEAD");
if (!branch) process.exit(0); // not a git checkout — nothing to say

// A stale local `origin/main` is the trap inside the trap: without this fetch
// the counts below are measured against whatever main looked like when this
// worktree was created, which is exactly the wrong answer.
spawnSync("git", ["fetch", "--quiet", "origin", "main"], { encoding: "utf8" });

const counts = git("rev-list", "--left-right", "--count", "HEAD...origin/main");
if (!counts) process.exit(0);
const [ahead, behind] = counts.split(/\s+/).map(Number);

const lastCommit = git("log", "-1", "--format=%cr") ?? "unknown";
const dirty = (git("status", "--porcelain") ?? "").split("\n").filter(Boolean).length;

const lines = [
  `worktree: ${process.cwd().split("/").slice(-1)[0]}  branch: ${branch}`,
  `vs origin/main: ${behind} behind, ${ahead} ahead   last commit: ${lastCommit}` +
    (dirty ? `   uncommitted: ${dirty} file(s)` : ""),
];

if (behind >= 25) {
  lines.push(
    "",
    `⚠️  STALE CHECKOUT — ${behind} commits behind origin/main.`,
    "   Code here may be weeks out of date. Do NOT conclude a feature is missing,",
    "   broken, or unimplemented from what you read in this tree until you rebase",
    "   or start a fresh worktree from origin/main.",
    "   Rebase:  git fetch origin main && git rebase origin/main",
  );
} else if (behind >= 5) {
  lines.push(`   (${behind} behind — rebase onto origin/main before opening a PR.)`);
}

if (dirty > 0) {
  lines.push(
    "",
    `⚠️  ${dirty} uncommitted file(s). Another session may have left work here —`,
    "   read it before you reset, stash, or check out anything.",
  );
}

console.log(lines.join("\n"));
