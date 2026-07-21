#!/usr/bin/env node
/**
 * @fileoverview CI guard — ban the append-only Agents-SDK `this.schedule()` in
 * Durable Objects.
 *
 * WHY: `this.schedule()` inserts a row into the SDK's internal `cf_agents_schedules`
 * table on EVERY call and never dedupes. Re-arming it unconditionally (e.g. from
 * onStart() + a finally block) compounds pending rows without bound; the table grew
 * to ~1M rows and every alarm full-scanned it, billing 537B Durable Object row reads
 * in 30 days (~$512+). See src/backend/services/safety/do-circuit-breaker.ts and
 * commit 26b7607 / PR #162.
 *
 * THE RULE: new alarm-bearing DOs use native `ctx.storage.setAlarm()` — a DO has
 * exactly one alarm slot; setAlarm REPLACES, so it structurally cannot grow a table.
 *
 * This check fails CI if `this.schedule(` appears anywhere under src/ except the one
 * audited, breaker-guarded legacy file in ALLOWLIST. Run via `pnpm run check` or
 * `pnpm run check:do-alarms`.
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

/**
 * The ONLY file allowed to call `this.schedule()`. RemodelOrchestrator is the
 * pre-existing Agents-SDK DO; it is hardened with a DELETE-before-schedule dedupe
 * (#162) AND the circuit-breaker guard. New DOs must NOT be added here — use
 * native `ctx.storage.setAlarm()` instead.
 */
const ALLOWLIST = new Set(["src/backend/ai/agents/RemodelOrchestrator/index.ts"]);

const BANNED = /\bthis\.schedule\s*\(/;

let files;
try {
  files = execSync("git ls-files src", { encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
} catch (err) {
  console.error("check-do-alarms: could not list files —", err.message);
  process.exit(2);
}

const offenders = [];
for (const file of files) {
  if (ALLOWLIST.has(file)) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (BANNED.test(text)) {
    const line = text.split("\n").findIndex((l) => BANNED.test(l)) + 1;
    offenders.push(`${file}:${line}`);
  }
}

if (offenders.length > 0) {
  console.error(
    "\n\x1b[31m✗ Banned this.schedule() in a Durable Object.\x1b[0m\n" +
      "  The append-only Agents-SDK schedule() caused the $700 cf_agents_schedules\n" +
      "  runaway (537B DO row reads, #162). Use native ctx.storage.setAlarm() instead\n" +
      "  (one self-replacing alarm slot — it cannot grow a table).\n",
  );
  offenders.forEach((o) => console.error(`    - ${o}`));
  console.error("");
  process.exit(1);
}

console.log("\x1b[32m✓\x1b[0m check-do-alarms: no banned this.schedule() usage in DOs");
