#!/usr/bin/env node
/**
 * @fileoverview QC runner — resolves a PR number to `scripts/qc/pr_<n>.mjs`.
 *
 * npm/pnpm script NAMES cannot take a parameter, so `test:pr:##` isn't
 * expressible; the number is passed as an argument instead:
 *
 *   pnpm run test:pr 151
 *   pnpm run test:pr 151 -- --sweep
 *   pnpm run test:pr 151 -- --base https://<preview-url>
 *   pnpm run test:pr --all          # every QC script, in PR order
 *
 * Exits non-zero if any run fails, so this is CI-usable as-is.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const QC_DIR = dirname(fileURLToPath(import.meta.url));

/** Every pr_<n>.mjs present, ascending by PR number. */
function allScripts() {
  return readdirSync(QC_DIR)
    .filter((f) => /^pr_\d+\.mjs$/.test(f))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
}

function run(file, passthrough) {
  console.log(`\n──────── ${file} ────────`);
  const res = spawnSync(process.execPath, [join(QC_DIR, file), ...passthrough], {
    stdio: "inherit",
  });
  return res.status ?? 1;
}

const args = process.argv.slice(2);

if (args.includes("--all")) {
  const passthrough = args.filter((a) => a !== "--all");
  const files = allScripts();
  if (files.length === 0) {
    console.error("No scripts/qc/pr_*.mjs found.");
    process.exit(1);
  }
  const failures = files.filter((f) => run(f, passthrough) !== 0);
  console.log(
    failures.length === 0
      ? `\nAll ${files.length} QC script(s) passed.\n`
      : `\n${failures.length}/${files.length} QC script(s) FAILED: ${failures.join(", ")}\n`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

const pr = args.find((a) => /^\d+$/.test(a));
if (!pr) {
  console.error(
    "usage: pnpm run test:pr <pr-number> [-- --sweep --base <url>]\n" +
      "       pnpm run test:pr --all\n\n" +
      `available: ${allScripts().join(", ") || "(none yet)"}`,
  );
  process.exit(2);
}

const file = `pr_${pr}.mjs`;
if (!existsSync(join(QC_DIR, file))) {
  console.error(
    `scripts/qc/${file} does not exist.\n` +
      "Every PR must ship one (see AGENTS.md → Pull-request workflow).\n" +
      `available: ${allScripts().join(", ") || "(none yet)"}`,
  );
  process.exit(2);
}

process.exit(run(file, args.filter((a) => a !== pr)));
