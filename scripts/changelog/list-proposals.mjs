#!/usr/bin/env node
/**
 * @fileoverview List feature proposals — the no-MCP path.
 *
 * Usage:
 *   node scripts/changelog/list-proposals.mjs
 *   node scripts/changelog/list-proposals.mjs --status proposed
 *   node scripts/changelog/list-proposals.mjs --status proposed --json
 */
import { createClient, resolveBase } from "../config.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const status = arg("status");
const limit = arg("limit");
const query = new URLSearchParams();
if (status) query.set("status", status);
if (limit) query.set("limit", limit);
const qs = query.toString();

const res = await createClient().get(`/api/changelog/proposals${qs ? `?${qs}` : ""}`);
if (res.status !== 200) {
  console.error(`✗ GET /api/changelog/proposals → ${res.status}`);
  console.error(res.json ? JSON.stringify(res.json, null, 2) : res.text.slice(0, 500));
  process.exit(1);
}

const { proposals } = res.json;
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(proposals, null, 2));
  process.exit(0);
}

console.log(`\nFeature proposals${status ? ` (${status})` : ""} — ${proposals.length}\n`);
for (const p of proposals) {
  const kb = p.contextBytes ? `${(p.contextBytes / 1024).toFixed(0)} KB` : "no transcript";
  console.log(`  ${p.status.padEnd(12)} ${p.slug}`);
  console.log(`               ${kb}   branch: ${p.branch ?? "—"}   PR: ${p.prNumber ?? "—"}`);
  console.log(`               ${resolveBase()}/admin/changelog/preview/${p.slug}`);
}
console.log("");
