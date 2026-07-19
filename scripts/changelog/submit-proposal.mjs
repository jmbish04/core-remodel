#!/usr/bin/env node
/**
 * @fileoverview File a feature proposal from the CLI — the no-MCP path.
 *
 * Same three operations as the `changelog` MCP tools, for a coding agent that
 * has a shell but no MCP connection. This posts to the SAME endpoint the MCP
 * tool calls in-process (`POST /api/changelog/proposals`), so there is one
 * implementation of the R2 + hash + upsert logic, not two.
 *
 * The transcript is read straight off disk and sent VERBATIM. Do not pre-digest
 * it: the rejected alternatives and the mid-conversation constraints are the
 * entire point, and they are what a summary throws away. If your dump is partial
 * (e.g. it only reaches a compaction boundary), pass --coverage to say so.
 *
 * Usage:
 *   node scripts/changelog/submit-proposal.mjs \
 *     --slug voice-measurement-capture \
 *     --title "Voice measurement capture" \
 *     --summary "Speak measurements while walking the house." \
 *     --prd docs/proposals/PRD.md \
 *     --design-brief docs/proposals/DESIGN_BRIEF.md \
 *     --prompt docs/proposals/PROMPT.md \
 *     --context ~/.claude/sessions/abc123.md \
 *     --coverage "Only up to the compaction boundary." \
 *     --tasks docs/proposals/TASKS.json \
 *     --branch claude/voice-capture --pr 162 --status proposed
 */
import { readFileSync } from "node:fs";

import { createClient, resolveBase } from "../config.mjs";

/** Read `--flag value`; returns null when absent. */
function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** Read a file when the flag is present, else null. Fails loudly on a bad path. */
function fileArg(name) {
  const path = arg(name);
  if (!path) return null;
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    console.error(`✗ --${name}: cannot read ${path} — ${err.message}`);
    process.exit(1);
  }
}

const slug = arg("slug");
if (!slug) {
  console.error("✗ --slug is required. See the header of this file for usage.");
  process.exit(1);
}

const tasksRaw = fileArg("tasks");
let tasks;
if (tasksRaw) {
  try {
    tasks = JSON.parse(tasksRaw);
  } catch (err) {
    console.error(`✗ --tasks is not valid JSON — ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(tasks)) {
    console.error("✗ --tasks must be a JSON array of task objects.");
    process.exit(1);
  }
}

const context = fileArg("context");
const prNumber = arg("pr");

const body = {
  slug,
  title: arg("title") ?? undefined,
  summary: arg("summary") ?? undefined,
  area: arg("area") ?? undefined,
  branch: arg("branch") ?? undefined,
  prNumber: prNumber ? Number(prNumber) : undefined,
  planSlug: arg("plan") ?? undefined,
  status: arg("status") ?? undefined,
  sourceKind: arg("source-kind") ?? "coding_agent",
  sourceModel: arg("source-model") ?? undefined,
  prdMarkdown: fileArg("prd") ?? undefined,
  designBriefMarkdown: fileArg("design-brief") ?? undefined,
  promptMarkdown: fileArg("prompt") ?? undefined,
  context: context ?? undefined,
  contextCoverageNote: arg("coverage") ?? undefined,
  tasks,
};

const client = createClient();
const res = await client.post("/api/changelog/proposals", body);

if (res.status !== 200 && res.status !== 201) {
  console.error(`✗ POST /api/changelog/proposals → ${res.status}`);
  console.error(res.json ? JSON.stringify(res.json, null, 2) : res.text.slice(0, 500));
  process.exit(1);
}

const r = res.json;
console.log(`\n✓ ${r.created ? "Filed" : "Updated"} proposal "${r.slug}"`);
if (context) {
  const kb = (r.contextBytes / 1024).toFixed(1);
  console.log(`  transcript: ${kb} KB${r.contextUnchanged ? " (unchanged — not re-uploaded)" : ""}`);
  if (!body.contextCoverageNote) {
    console.log("  ⚠ no --coverage note: a reader cannot tell whether the transcript is complete.");
  }
}
if (r.tasksSeeded) console.log(`  tasks seeded: ${r.tasksSeeded} → plan "${r.planSlug}"`);
console.log(`  ${resolveBase()}/admin/changelog/preview/${r.slug}\n`);
