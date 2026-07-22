/**
 * @fileoverview Runnable check for the browser chalk shim.
 *
 *   npx tsx scripts/checks/chalk-shim.check.ts
 *
 * The failure this guards against is silent and total: Ink renders a `#rrggbb`
 * color prop by calling `chalk.hex(color)(text)`, and a shim missing that method
 * throws inside the Ink reconciler — surfacing as "Error initializing Yoga or
 * rendering Ink" with nothing pointing at color.
 */
import assert from "node:assert/strict";

import chalk from "../../src/frontend/lib/shims/chalk";

const ESC = String.fromCharCode(27);
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

console.log("\nchalk shim\n");

check("hex emits a truecolor foreground sequence", () => {
  assert.equal(chalk.hex("#4ade80")("ok"), `${ESC}[38;2;74;222;128mok${ESC}[39m`);
});

check("bgHex emits a truecolor background sequence", () => {
  assert.equal(chalk.bgHex("#123456")("ok"), `${ESC}[48;2;18;52;86mok${ESC}[49m`);
});

check("3-digit hex expands", () => {
  assert.equal(chalk.hex("#fff")("x"), `${ESC}[38;2;255;255;255mx${ESC}[39m`);
});

check("named colors still work", () => {
  assert.equal(chalk.red("ok"), `${ESC}[31mok${ESC}[39m`);
});

check("styles chain without leaking into siblings", () => {
  const chained = chalk.bold.hex("#ff0000")("x");
  assert.ok(chained.includes("38;2;255;0;0"), "missing hex in chain");
  assert.ok(chained.includes(`${ESC}[1m`), "missing bold in chain");
  // The sibling must be unaffected by the chain above it.
  assert.equal(chalk.red("y"), `${ESC}[31my${ESC}[39m`);
});

check("rgb / ansi256 exist", () => {
  assert.equal(chalk.rgb(1, 2, 3)("z"), `${ESC}[38;2;1;2;3mz${ESC}[39m`);
  assert.equal(chalk.ansi256(42)("z"), `${ESC}[38;5;42mz${ESC}[39m`);
});

check("invalid hex degrades to white rather than throwing", () => {
  assert.equal(chalk.hex("nonsense")("z"), `${ESC}[38;2;255;255;255mz${ESC}[39m`);
});

console.log(failures === 0 ? "\nall passed\n" : `\n${failures} failed\n`);
process.exit(failures === 0 ? 0 : 1);
