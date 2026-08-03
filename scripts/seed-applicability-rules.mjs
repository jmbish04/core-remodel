#!/usr/bin/env node
/**
 * Seed material-applicability rules into `ripple_rules` (0043 §5c).
 *
 *   node scripts/seed-applicability-rules.mjs            # dry run
 *   node scripts/seed-applicability-rules.mjs --apply
 *
 * These share the `ripple_rules` engine with physical ripples but carry
 * rule_kind = 'material_applicability' and a `resolution`. The value is which
 * branches are QUESTIONS: tile continuing into a bathroom is genuinely ambiguous
 * (must_confirm); hardwood continuing into a bathroom almost never is
 * (auto_exclude); the stair strategy when one level is chosen has no defensible
 * default (must_specify). An app that asks both is a nag; one that asks neither
 * is wrong. Idempotent INSERT OR IGNORE on the unique `key`.
 */

import { execFileSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const LOCAL = process.argv.includes("--local");
const DB = "core-remodel";
const q = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

// key, trigger_name, trigger_match(JSON), resolution, rationale, strength
const RULES = [
  {
    key: "tile_whole_house_into_bathrooms",
    triggerName: "Tile flooring applied whole-house",
    match: { materialTypeKey: "TILE", scope: "project" },
    resolution: "must_confirm",
    rationale:
      "You are applying tile across the whole house. Do you want it to continue into the bathrooms, or should the bathrooms have their own tile?",
    strength: "usually",
  },
  {
    key: "hardwood_whole_house_excludes_bathrooms",
    triggerName: "Hardwood or carpet applied whole-house",
    match: { materialTypeKey: "FLOORING", family: "hardwood|carpet", scope: "project" },
    resolution: "auto_exclude",
    rationale:
      "Hardwood and carpet almost never continue into bathrooms. The bathrooms are assumed to get a different, water-tolerant floor — change this if that is wrong.",
    strength: "usually",
  },
  {
    key: "flooring_multi_level_pick_scope",
    triggerName: "Flooring applied in a multi-level home",
    match: { materialTypeKey: "FLOORING", multiLevel: true },
    resolution: "must_confirm",
    rationale:
      "This home has multiple levels. Is this flooring for the whole house, or only one level?",
    strength: "always",
  },
  {
    key: "flooring_single_level_stair_strategy",
    triggerName: "Flooring applied to one level of a multi-level home",
    match: { materialTypeKey: "FLOORING", scope: "floor", multiLevel: true },
    resolution: "must_specify",
    rationale:
      "You are re-flooring one level. The stairs are the seam between two flooring strategies and there is no safe default: will the stairs change to match the updated level, or stay as they are?",
    strength: "always",
  },
  {
    key: "tile_continuous_across_floor",
    triggerName: "Tile applied across one continuous floor",
    match: { materialTypeKey: "TILE", scope: "room", continuous: true },
    resolution: "auto_apply",
    rationale:
      "Tile continues across a single continuous floor without a threshold — applied as one field.",
    strength: "always",
  },
];

const statements = RULES.map(
  (r) =>
    `INSERT OR IGNORE INTO ripple_rules (key, trigger_name, trigger_match, consequences, rationale, strength, jurisdiction, rule_kind, resolution, is_active) ` +
    `VALUES (${q(r.key)}, ${q(r.triggerName)}, ${q(JSON.stringify(r.match))}, '[]', ${q(r.rationale)}, ${q(r.strength)}, NULL, 'material_applicability', ${q(r.resolution)}, 1);`,
);

console.log(`seed-applicability-rules: ${statements.length} rules`);

if (!APPLY) {
  console.log("\n--- dry run; pass --apply ---\n");
  console.log(statements.join("\n"));
  process.exit(0);
}

const target = LOCAL ? "--local" : "--remote";
execFileSync("npx", ["wrangler", "d1", "execute", DB, target, "--command", statements.join(" ")], {
  stdio: ["ignore", "ignore", "inherit"],
});
console.log("seed-applicability-rules: done");
