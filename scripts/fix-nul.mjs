#!/usr/bin/env node
/**
 * One-shot: replace a raw NUL byte in a source file with its `\0` escape.
 *
 * `dedup_showroom_stores.ts` carried a literal 0x00 inside `.join("…")` — a
 * deliberate separator, written as the byte instead of an escape. Same runtime
 * value either way, but the raw byte makes git, grep and every code-review tool
 * classify the file as BINARY, so its contents never appear in a diff. That is
 * how a bug hides in plain sight.
 *
 * Usage: node scripts/fix-nul.mjs <file>
 */
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/fix-nul.mjs <file>");
  process.exit(1);
}

const before = readFileSync(file);
const nulCount = before.filter((b) => b === 0).length;
if (nulCount === 0) {
  console.log(`${file}: no NUL bytes, nothing to do`);
  process.exit(0);
}

// Build the needle from its char code — a literal NUL cannot be typed into source
// without reintroducing the exact problem this script exists to remove.
const text = before.toString("utf8").split(String.fromCharCode(0)).join("\\0");
writeFileSync(file, text, "utf8");

const after = readFileSync(file);
console.log(`${file}: replaced ${nulCount} NUL byte(s); now ${after.filter((b) => b === 0).length} remain`);
