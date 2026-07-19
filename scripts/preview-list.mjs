#!/usr/bin/env node
/**
 * preview-list.mjs — what preview workers does this tooling believe it created?
 *
 * Read-only. Use it to answer "is my preview up?" and "whose previews are
 * lying around?" without giving any command the ability to delete something.
 */
import { readLedger } from "./preview-ledger.mjs";

const ledger = readLedger();
if (ledger.length === 0) {
  console.log("\nPreview ledger is empty.\n");
  process.exit(0);
}
console.log(`\n${ledger.length} preview worker(s) recorded:\n`);
for (const e of ledger) {
  console.log(`  https://${e.worker}.hacolby.workers.dev`);
  console.log(`      branch: ${e.branch}`);
  console.log(`      created: ${e.createdAt}`);
  console.log(`      worktree: ${e.worktree}\n`);
}
console.log("Tear down the current branch's: pnpm run preview:delete");
console.log("Sweep orphans (branch gone):    pnpm run preview:cleanup\n");
