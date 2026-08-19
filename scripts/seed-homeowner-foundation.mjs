#!/usr/bin/env node
/**
 * Seed the 0041 Phase 0 definition tables.
 *
 *   node scripts/seed-homeowner-foundation.mjs            # dry run, prints SQL
 *   node scripts/seed-homeowner-foundation.mjs --apply    # --remote
 *   node scripts/seed-homeowner-foundation.mjs --apply --local
 *
 * Idempotent: every insert is INSERT OR IGNORE against a UNIQUE key, so running
 * it twice is a no-op and adding a row to this file and re-running seeds only
 * the new one.
 *
 * Statements are chunked well under D1's 100-bound-parameter cap. These use
 * literal values rather than bindings, so the cap is not in play, but the
 * chunking stays because a single enormous statement is its own problem.
 *
 * Also seeds one `projects` row, but only once a primary property exists —
 * `projects.propertyId` is a NOT NULL FK. Run
 * `scripts/backfill-primary-property.mjs --apply` first if it is missing.
 *
 * NOT SEEDED HERE, deliberately:
 *   - room line colours. Assigning 19 rooms a permanent identity colour is a
 *     design decision that gets proposed and reviewed, not silently defaulted.
 */

import { execFileSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const LOCAL = process.argv.includes("--local");
const DB = "core-remodel";

const q = (v) =>
  v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
const b = (v) => (v ? 1 : 0);

// ── Spec definitions ────────────────────────────────────────────────────────
// The vocabulary of what a room can specify. `required` gates the
// translation-ready threshold — roomReadiness() reads exactly this flag.
//
// Kept deliberately small. These are the questions a contractor actually needs
// answered before quoting; every additional required field is a wall a homeowner
// has to climb, so the bar for adding one is that a trade cannot price without it.
const SPECS = [
  // key, name, family, valueKind, required, sortOrder, description
  ["room_scope", "What is changing in this room", "scope", "text", true, 10,
    "A plain-language description of the work. A trade cannot price a room without knowing what is being changed."],
  ["dimensions_confirmed", "Confirmed dimensions", "scope", "dimension", true, 20,
    "Measured, not estimated. Everything downstream — slab, cabinetry, fixtures — is cut from these."],
  ["plumbing_fixtures", "Plumbing fixtures", "fixtures", "product", true, 30,
    "The actual fixtures, as purchasable products. Rough-in locations depend on the specific model, not the category."],
  ["electrical_scope", "Electrical scope", "systems", "text", true, 40,
    "Circuits, loads, and anything that touches the panel. Determines whether a service upgrade is in play."],
  ["surface_finishes", "Surface finishes", "finishes", "material", true, 50,
    "Tile, stone, paint — the materials themselves, so quantities and lead times are real."],
  ["drywall_finish_level", "Drywall finish level", "finishes", "choice", false, 60,
    "Level 3 through 5. Level 5 costs more and shows less; it matters most under raking light and flat paint."],
  ["lighting_plan", "Lighting plan", "systems", "text", false, 70,
    "Fixture positions and switching. Cheap to change on paper, expensive after rough-in."],
  ["ventilation", "Ventilation", "systems", "text", false, 80,
    "Exhaust and make-up air. Frequently discovered late, and frequently a permit item."],
  ["cabinetry", "Cabinetry and millwork", "finishes", "product", false, 90,
    "Built-ins and cabinets, with model and finish, so shop drawings can be produced."],
  ["appliance_schedule", "Appliances", "fixtures", "product", false, 100,
    "Specific models. Fuel type and clearances drive gas, electrical, and ventilation."],
];

// ── Impact definitions ──────────────────────────────────────────────────────
// Ripples, party actions, schedule, money, field, external — all one object
// type. riskInputs declares which impact columns feed scoring, so a new kind is
// configuration rather than a migration.
const IMPACTS = [
  // key, name, family, severity, requiresActor, riskInputs, description
  ["ripple", "Ripple from another decision", "ripple", 50, false,
    '["daysExposure","costExposureCents","confidence"]',
    "A choice somewhere else invalidated something here. The most common impact in a real project."],

  ["homeowner_change_of_mind", "Changed your mind", "party", 30, false,
    '["daysExposure","costExposureCents"]',
    "Legitimate and expected. Recorded so the consequences are visible — never as a mark against anyone."],
  ["contractor_terminated", "Contractor terminated", "party", 80, true,
    '["daysExposure","costExposureCents"]',
    "The homeowner ended the relationship."],
  ["contractor_abandonment", "Contractor abandoned the job", "party", 90, true,
    '["daysExposure","costExposureCents"]',
    "They walked. Opens the relationship, licensing, permit, and payment branches at once."],
  ["bad_faith", "Bad faith", "party", 90, true,
    '["costExposureCents","daysExposure"]',
    "Conduct inconsistent with the agreement. Attribution here is the entire point — this record is what goes to a lawyer or a board."],
  ["contract_breach", "Contract breach", "party", 85, true,
    '["costExposureCents"]',
    "A specific term of the written contract was not honoured."],
  ["fraud", "Fraud or misrepresentation", "party", 95, true,
    '["costExposureCents"]',
    "Misrepresentation, forged paperwork, or billing for work not performed."],
  ["sub_loss", "Lost a subcontractor", "party", 60, true,
    '["daysExposure","costExposureCents"]',
    "Through nobody's fault — they took other work or went out of business."],
  ["vendor_failure", "Vendor did not deliver", "party", 55, true,
    '["daysExposure","costExposureCents"]',
    "Would not honour a quote, indefinite backorder, or discontinued mid-project."],

  ["permit_delay", "Permit delay", "schedule", 65, false,
    '["daysExposure"]',
    "Review or inspection is taking longer than planned."],
  ["shipping_delay", "Material delay", "schedule", 50, false,
    '["daysExposure","costExposureCents"]',
    "An ordered material slipped. Matters most when it sits on the critical path."],
  ["utility_dependency", "Waiting on a utility", "schedule", 70, false,
    '["daysExposure"]',
    "Service upgrades and meter work run on the utility's calendar, not yours."],
  ["weather", "Weather", "schedule", 35, false,
    '["daysExposure"]',
    "Exterior and moisture-sensitive work only."],

  ["cost_overrun", "Cost overrun", "money", 70, false,
    '["costExposureCents"]',
    "Evidenced by receipts and invoices, not by estimate drift."],

  ["demo_discovery", "Found during demo", "field", 80, false,
    '["costExposureCents","daysExposure"]',
    "Mold, asbestos, knob-and-tube, rot, or anything else the walls were hiding."],

  ["code_change", "Code changed", "external", 60, false,
    '["costExposureCents","daysExposure"]',
    "A requirement moved between design and filing."],
  ["macro", "Market or macro shock", "external", 45, false,
    '["costExposureCents","daysExposure"]',
    "Tariffs, supply shocks, labour shortages. No room caused it and no room can fix it."],
];

// ── Ripple rules ────────────────────────────────────────────────────────────
// The curated construction knowledge that makes the graph non-empty on day one.
// `consequences[].reason` is the label the blast-radius lens renders — authored
// here, never generated at render time.
const RULES = [
  {
    key: "wall_relocation",
    triggerName: "Moving or removing a wall",
    triggerMatch: { specKeys: ["room_scope"], keywords: ["move wall", "remove wall", "open up", "relocate wall"] },
    consequences: [
      { targetKind: "room", effect: "reopens", reason: "shared wall" },
      { targetKind: "room", effect: "reopens", reason: "plumbing in the wall" },
      { targetKind: "room", effect: "reopens", reason: "electrical in the wall" },
      { targetKind: "permit", effect: "blocks", reason: "structural review" },
      { targetKind: "room", effect: "reopens", reason: "flooring transition" },
      { targetKind: "room", effect: "delays", reason: "HVAC routing" },
    ],
    rationale:
      "A wall is rarely only a wall. It may be carrying load, and it almost always carries services. " +
      "Anything routed through it has to go somewhere else, and the floor has to meet itself where the wall used to be.",
    strength: "always",
  },
  {
    key: "range_fuel_change",
    triggerName: "Changing a range's fuel type",
    triggerMatch: { specKeys: ["appliance_schedule"], keywords: ["induction", "gas range", "dual fuel", "cooktop"] },
    consequences: [
      { targetKind: "room", effect: "reopens", reason: "gas line required or abandoned" },
      { targetKind: "project", effect: "reopens", reason: "panel capacity" },
      { targetKind: "permit", effect: "delays", reason: "electrical or gas permit" },
      { targetKind: "room", effect: "reopens", reason: "ventilation requirement" },
      { targetKind: "budget_line", effect: "inflates", reason: "appliance cost delta" },
    ],
    rationale:
      "Fuel type is not an appliance preference, it is an infrastructure decision. Induction draws a large " +
      "dedicated circuit and can force a service upgrade; gas needs a line and changes the ventilation requirement.",
    strength: "always",
  },
  {
    key: "drain_relocation",
    triggerName: "Relocating a drain",
    triggerMatch: { specKeys: ["plumbing_fixtures"], keywords: ["move drain", "relocate toilet", "shift shower"] },
    consequences: [
      { targetKind: "room", effect: "blocks", reason: "slab or subfloor work" },
      { targetKind: "room", effect: "reopens", reason: "waterproofing sequence" },
      { targetKind: "permit", effect: "blocks", reason: "rough plumbing inspection" },
      { targetKind: "budget_line", effect: "inflates", reason: "concrete or framing work" },
    ],
    rationale:
      "Drains fall by gravity, so moving one is a slope problem, not a plumbing preference. On a slab it means " +
      "cutting concrete; above a floor it means depth the joists may not have.",
    strength: "always",
  },
  {
    key: "tile_selection_change",
    triggerName: "Changing a tile or stone selection",
    triggerMatch: { specKeys: ["surface_finishes"], keywords: ["tile", "slab", "stone", "porcelain"] },
    consequences: [
      { targetKind: "room", effect: "reopens", reason: "substrate and setting bed depth" },
      { targetKind: "room", effect: "reopens", reason: "transition heights at doorways" },
      { targetKind: "budget_line", effect: "inflates", reason: "material and labour delta" },
      { targetKind: "delivery", effect: "delays", reason: "lead time" },
    ],
    rationale:
      "Thickness and format change the build-up under the finish, which changes finished floor height, which " +
      "changes every threshold the room touches.",
    strength: "usually",
  },
  {
    key: "scope_added_after_permit",
    triggerName: "Adding scope after the permit is filed",
    triggerMatch: { specKeys: ["room_scope"], keywords: ["also", "while we're at it", "add"] },
    consequences: [
      { targetKind: "permit", effect: "blocks", reason: "revision required" },
      { targetKind: "project", effect: "delays", reason: "re-review" },
      { targetKind: "contractor", effect: "inflates", reason: "change order" },
    ],
    rationale:
      "Filed drawings are a promise about what will be built. Work outside them is either a revision or " +
      "unpermitted, and unpermitted work surfaces at the worst possible moment — resale.",
    strength: "always",
  },
];

// ── Emit ────────────────────────────────────────────────────────────────────

const statements = [];

for (const [key, name, family, valueKind, required, sortOrder, description] of SPECS) {
  statements.push(
    `INSERT OR IGNORE INTO spec_definitions (key, name, description, value_kind, is_required_for_threshold, applies_to_room_kinds, sort_order, is_active) VALUES (${q(key)}, ${q(name)}, ${q(description)}, ${q(valueKind)}, ${b(required)}, NULL, ${sortOrder}, 1);`,
  );
}

for (const [key, name, family, severity, requiresActor, riskInputs, description] of IMPACTS) {
  statements.push(
    `INSERT OR IGNORE INTO impact_definitions (key, name, family, description, risk_inputs, default_severity, requires_actor_party, is_active) VALUES (${q(key)}, ${q(name)}, ${q(family)}, ${q(description)}, ${q(riskInputs)}, ${severity}, ${b(requiresActor)}, 1);`,
  );
}

for (const r of RULES) {
  statements.push(
    `INSERT OR IGNORE INTO ripple_rules (key, trigger_name, trigger_match, consequences, rationale, strength, jurisdiction, is_active) VALUES (${q(r.key)}, ${q(r.triggerName)}, ${q(JSON.stringify(r.triggerMatch))}, ${q(JSON.stringify(r.consequences))}, ${q(r.rationale)}, ${q(r.strength)}, NULL, 1);`,
  );
}

// ── The project row ─────────────────────────────────────────────────────────
// Guarded by a SELECT so it is a no-op when no primary property exists yet, and
// a no-op on re-run. `title` is the effort's own name; the property's label is
// JOINED from `properties`, never copied here.
statements.push(
  `INSERT INTO projects (property_id, title, slug, project_type, is_active) ` +
    `SELECT p.id, 'Whole-house remodel', 'primary', 'lifestyle_change', 1 FROM properties p ` +
    `WHERE p.is_primary = 1 AND NOT EXISTS (SELECT 1 FROM projects WHERE slug = 'primary');`,
);

// Chunk so no single execute carries an unreasonable payload.
const CHUNK = 20;
const chunks = [];
for (let i = 0; i < statements.length; i += CHUNK) chunks.push(statements.slice(i, i + CHUNK));

console.log(
  `seed-homeowner-foundation: ${SPECS.length} spec definitions, ${IMPACTS.length} impact definitions, ${RULES.length} ripple rules ` +
    `= ${statements.length} statements in ${chunks.length} chunk(s)`,
);

if (!APPLY) {
  console.log("\n--- dry run; pass --apply to execute ---\n");
  console.log(statements.join("\n"));
  process.exit(0);
}

const target = LOCAL ? "--local" : "--remote";
chunks.forEach((chunk, i) => {
  process.stdout.write(`  chunk ${i + 1}/${chunks.length} … `);
  execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DB, target, "--command", chunk.join(" ")],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  console.log("ok");
});
console.log("seed-homeowner-foundation: done");
