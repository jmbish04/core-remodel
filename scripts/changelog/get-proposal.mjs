#!/usr/bin/env node
/**
 * @fileoverview Pull a feature proposal back — the no-MCP path.
 *
 * Read this BEFORE implementing a proposal. `--context` fetches the raw
 * conversation the idea came out of, which is where the rejected alternatives
 * and the constraints discovered mid-discussion live. The PRD is the conclusion;
 * the transcript is the reasoning.
 *
 * Usage:
 *   node scripts/changelog/get-proposal.mjs --slug voice-measurement-capture
 *   node scripts/changelog/get-proposal.mjs --slug voice-measurement-capture --context
 *   node scripts/changelog/get-proposal.mjs --slug voice-measurement-capture --context -o CONTEXT.md
 *   node scripts/changelog/get-proposal.mjs --slug voice-measurement-capture --json
 */
import { writeFileSync } from "node:fs";

import { accessCookie, createClient, resolveBase } from "../config.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}
const has = (name) => process.argv.includes(`--${name}`);

const slug = arg("slug");
if (!slug) {
  console.error("✗ --slug is required.");
  process.exit(1);
}

const client = createClient();
const res = await client.get(`/api/changelog/proposals/${encodeURIComponent(slug)}`);
if (res.status === 404) {
  console.error(`✗ No proposal with slug "${slug}".`);
  process.exit(1);
}
if (res.status !== 200) {
  console.error(`✗ GET /api/changelog/proposals/${slug} → ${res.status}`);
  console.error(res.text.slice(0, 500));
  process.exit(1);
}

const bundle = res.json;
if (has("json")) {
  console.log(JSON.stringify(bundle, null, 2));
  process.exit(0);
}

const { proposal, entry, tasks, context } = bundle;
console.log(`\n${entry?.title ?? proposal.slug}  [${proposal.status}]`);
if (entry?.summary) console.log(entry.summary);
console.log(
  `branch: ${proposal.branch ?? "—"}   PR: ${proposal.prNumber ?? "—"}   ` +
    `source: ${proposal.sourceKind}${proposal.sourceModel ? ` (${proposal.sourceModel})` : ""}`,
);

for (const [label, md] of [
  ["PRD", proposal.prdMarkdown],
  ["DESIGN BRIEF", proposal.designBriefMarkdown],
  ["PROMPT", proposal.promptMarkdown],
]) {
  if (!md) continue;
  console.log(`\n${"─".repeat(70)}\n${label}\n${"─".repeat(70)}\n${md}`);
}

if (tasks?.length) {
  console.log(`\n${"─".repeat(70)}\nTASKS (live status from plan_tasks)\n${"─".repeat(70)}`);
  for (const t of tasks) {
    console.log(`  [${t.status.padEnd(11)}] ${t.taskKey}  ${t.title}`);
  }
}

console.log(`\n${"─".repeat(70)}\nTRANSCRIPT\n${"─".repeat(70)}`);
if (!context.available) {
  console.log("  none stored.");
} else {
  const kb = (context.bytes / 1024).toFixed(1);
  console.log(`  ${kb} KB   sha256: ${context.sha256?.slice(0, 16)}…`);
  // Printed next to the link on purpose. A reader who assumes a dump is complete
  // draws confident wrong conclusions from whatever it silently omits.
  console.log(
    `  coverage: ${context.coverageNote ?? "NOT RECORDED — treat completeness as unknown, not assumed."}`,
  );
  console.log(`  ${resolveBase()}${context.href}`);
}

if (has("context") && context.available) {
  // Fetched directly rather than through the JSON client: this is a ~450KB
  // markdown stream, not a JSON body.
  const raw = await fetch(`${resolveBase()}${context.href}`, {
    headers: { cookie: accessCookie() },
  });
  if (!raw.ok) {
    console.error(`\n✗ transcript fetch → ${raw.status}`);
    process.exit(1);
  }
  const text = await raw.text();
  const out = arg("o") ?? arg("out");
  if (out) {
    writeFileSync(out, text);
    console.log(`\n✓ transcript written to ${out} (${text.length} chars)\n`);
  } else {
    console.log(`\n${"─".repeat(70)}\n${text}`);
  }
}
