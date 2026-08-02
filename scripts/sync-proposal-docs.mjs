#!/usr/bin/env node
/**
 * Push the `docs/####_*` bundles up to their changelog proposals, so the
 * preview a human reviews is byte-identical to the plan in the repo.
 *
 *   node scripts/sync-proposal-docs.mjs          # report drift only
 *   node scripts/sync-proposal-docs.mjs --apply
 *
 * WHY THIS EXISTS: the proposal bodies were being retyped by hand into the MCP
 * tool, which silently drifted from the committed docs. In one case a proposal
 * shipped with an EMPTY prd; in another, three substantive sections (room tense,
 * Home-is-the-floorplan, jurisdiction capability) existed in the repo and were
 * missing from the page anyone would actually read. Both were invisible until
 * someone asked.
 *
 * `CLAUDE.md` requires the proposal's PRD/PROMPT/tasks to MATCH the docs bundle.
 * This makes that mechanical instead of a promise.
 */

import fs from "node:fs";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const ROOT = process.cwd();

/** slug -> the files that back each markdown field. */
const BUNDLES = [
  {
    slug: "homeowner-experience",
    dir: "docs/0041_homeowner_experience",
    prdMarkdown: "IMPLEMENTATION_PLAN.md",
    designBriefMarkdown: "DESIGN_SPEC.md",
    promptMarkdown: "PROMPT.md",
  },
  {
    slug: "contracts-disputes",
    dir: "docs/0042_contracts_disputes",
    prdMarkdown: "IMPLEMENTATION_PLAN.md",
    promptMarkdown: "PROMPT.md",
  },
  {
    slug: "room-model-overhaul",
    dir: "docs/0043_room_model_overhaul",
    prdMarkdown: "IMPLEMENTATION_PLAN.md",
    designBriefMarkdown: "SCHEMA_DIAGRAMS.md",
    promptMarkdown: "PROMPT.md",
  },
];

const FIELDS = ["prdMarkdown", "designBriefMarkdown", "promptMarkdown"];

const read = (dir, file) => {
  if (!file) return null;
  const p = path.join(ROOT, dir, file);
  if (!fs.existsSync(p)) return { missing: p };
  return fs.readFileSync(p, "utf8");
};

const cfg = await import(path.join(ROOT, "scripts/config.mjs"));
const client = cfg.createClient();

let drift = 0;
let missingFiles = 0;

for (const bundle of BUNDLES) {
  console.log(`\n${bundle.slug}`);

  const res = await client.get(`/api/changelog/proposals/${bundle.slug}`);
  if (res.status !== 200) {
    console.log(`  ! GET returned ${res.status} — skipping`);
    continue;
  }
  const live = res.json?.proposal ?? res.json ?? {};

  const body = { slug: bundle.slug };
  let bundleDrift = false;

  for (const field of FIELDS) {
    const fileName = bundle[field];
    if (!fileName) continue;

    const content = read(bundle.dir, fileName);
    if (content && typeof content === "object" && content.missing) {
      console.log(`  ✗ ${field.padEnd(20)} FILE MISSING — ${path.relative(ROOT, content.missing)}`);
      missingFiles += 1;
      continue;
    }

    const current = live[field] ?? "";
    const same = current === content;
    const mermaid = (content.match(/```mermaid/g) || []).length;

    console.log(
      `  ${same ? "=" : "→"} ${field.padEnd(20)} repo ${String(content.length).padStart(6)}` +
        ` | live ${String(current.length).padStart(6)}` +
        ` | ${String(mermaid).padStart(2)} mermaid` +
        `${same ? "" : "   DRIFT"}`,
    );

    if (!same) {
      bundleDrift = true;
      drift += 1;
      body[field] = content;
    }
  }

  if (!bundleDrift) {
    console.log("  in sync");
    continue;
  }
  if (!APPLY) continue;

  const put = await client.post("/api/changelog/proposals", body);
  console.log(`  ${put.status === 200 ? "pushed" : `! POST ${put.status}`}`);
}

console.log(
  `\n${drift} field(s) drifted${missingFiles ? `, ${missingFiles} file(s) missing` : ""}.` +
    (APPLY ? " Applied." : " Re-run with --apply to push."),
);
process.exit(missingFiles > 0 ? 1 : 0);
