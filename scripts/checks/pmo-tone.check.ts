/**
 * @fileoverview Runnable check for the PMO tone logic — 0028 P1.
 *
 *   npx tsx scripts/checks/pmo-tone.check.ts
 *
 * The two branchy pure functions: progress color is threshold-derived (a wrong
 * threshold silently mis-colors every ring), and the Gantt hue must be a stable
 * function of the id (a per-render-random hue would make a bar change color on
 * every scroll).
 */
import assert from "node:assert/strict";

import { ganttHue, progressColor } from "../../src/frontend/components/pmo/tone";

let failures = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}\n    ${(err as Error).message.split("\n")[0]}`);
  }
};

console.log("\npmo tone\n");

check("progress color crosses at 40 and 75", () => {
  assert.equal(progressColor(0), "text-rose-400");
  assert.equal(progressColor(39), "text-rose-400");
  assert.equal(progressColor(40), "text-amber-400");
  assert.equal(progressColor(74), "text-amber-400");
  assert.equal(progressColor(75), "text-emerald-400");
  assert.equal(progressColor(100), "text-emerald-400");
});

check("gantt hue is deterministic per id", () => {
  assert.equal(ganttHue("plan:42"), ganttHue("plan:42"));
  assert.match(ganttHue("plan:42"), /^#[0-9a-f]{6}$/);
});

check("gantt hue spreads across the ramp (not all one color)", () => {
  const hues = new Set(Array.from({ length: 30 }, (_, i) => ganttHue(`plan:${i}`)));
  assert.ok(hues.size >= 5, `only ${hues.size} distinct hues across 30 ids`);
});

console.log(failures === 0 ? "\nall passed\n" : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
