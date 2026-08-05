#!/usr/bin/env node
/**
 * Seed the 0043 Phase 4 surface definition tables:
 *   - assembly_layer_kind_def
 *   - fixture_type_def
 *   - fixture_requirements
 *
 * Usage:
 *   node scripts/seed-surfaces.mjs            # dry run, prints SQL
 *   node scripts/seed-surfaces.mjs --apply    # --remote
 *   node scripts/seed-surfaces.mjs --apply --local
 *
 * Idempotent: inserts use INSERT OR IGNORE / subqueries.
 * Statements are chunked in batches of 20.
 */

import { execFileSync } from "node:child_process";

const APPLY = process.argv.includes("--apply");
const LOCAL = process.argv.includes("--local");
const DB = "core-remodel";

const q = (v) =>
  v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;
const b = (v) => (v ? 1 : 0);

// Helper to generate three-format descriptions
const desc = (p) => ({
  markdown: p,
  html: `<p>${p}</p>`,
  plaintext: p,
});

// ── Assembly Layer Kind Definitions ──────────────────────────────────────────
// takeoff_unit ∈ sqft | linear_ft | each | gallons
// default_waste_factor ∈ real
const ASSEMBLY_LAYER_KIND_DEFS = [
  // key, name, takeoff_unit, default_waste_factor, description
  [
    "stud",
    "Stud Framing",
    "each",
    0.05,
    desc("Vertical wall framing studs and plates providing structural support."),
  ],
  [
    "insulation_batt",
    "Batt Insulation",
    "sqft",
    0.05,
    desc("Fiberglass or mineral wool insulation batts installed between wall studs or joists."),
  ],
  [
    "mineral_wool",
    "Mineral Wool Insulation",
    "sqft",
    0.05,
    desc("High-density mineral wool insulation providing thermal performance and fire/sound resistance."),
  ],
  [
    "mlv",
    "Mass Loaded Vinyl",
    "sqft",
    0.05,
    desc("Flexible heavy acoustic barrier sheet applied behind drywall to block sound transmission."),
  ],
  [
    "resilient_channel",
    "Resilient Channel",
    "linear_ft",
    0.05,
    desc("Metal decoupling channels attached across studs to reduce acoustic vibration transmission."),
  ],
  [
    "drywall",
    "Drywall",
    "sqft",
    0.10,
    desc("Gypsum board wall and ceiling panels for interior surface enclosure."),
  ],
  [
    "green_glue",
    "Green Glue",
    "each",
    0.0,
    desc("Viscoelastic damping compound applied between layers of drywall for sound isolation."),
  ],
  [
    "cement_board",
    "Cement Board",
    "sqft",
    0.10,
    desc("Water-resistant cementitious tile backer board for wet areas and shower walls."),
  ],
  [
    "waterproofing_membrane",
    "Waterproofing Membrane",
    "sqft",
    0.10,
    desc("Liquid-applied or sheet waterproofing membrane behind tile assemblies in wet locations."),
  ],
  [
    "uncoupling_membrane",
    "Uncoupling Membrane",
    "sqft",
    0.10,
    desc("Plastic or fleece uncoupling layer preventing subfloor movement from cracking floor tile."),
  ],
  [
    "thinset",
    "Thinset Mortar",
    "sqft",
    0.10,
    desc("Bonding mortar applied with a notched trowel to set ceramic or stone tile."),
  ],
  [
    "tile",
    "Tile",
    "sqft",
    0.15,
    desc("Ceramic, porcelain, or natural stone surface finish tiles."),
  ],
  [
    "grout",
    "Grout",
    "sqft",
    0.05,
    desc("Cementitious or epoxy filler between tile joints."),
  ],
  [
    "primer",
    "Primer",
    "gallons",
    0.05,
    desc("Preparatory coating applied to drywall or raw surfaces before painting."),
  ],
  [
    "paint",
    "Paint",
    "gallons",
    0.05,
    desc("Finished architectural paint coating for walls, ceilings, and trim."),
  ],
];

// ── Fixture Type Definitions ─────────────────────────────────────────────────
// applies_to_surface_kinds ∈ JSON array of wall_face, ceiling, floor
const FIXTURE_TYPE_DEFS = [
  // key, name, applies_to_surface_kinds (JSON string), description
  [
    "tv_mount",
    "TV Mount",
    '["wall_face"]',
    desc("Wall bracket assembly for television displays."),
  ],
  [
    "floating_vanity",
    "Floating Vanity",
    '["wall_face"]',
    desc("Wall-hung bathroom vanity cabinet and basin assembly."),
  ],
  [
    "medicine_cabinet",
    "Medicine Cabinet",
    '["wall_face"]',
    desc("Recessed or surface-mounted storage cabinet with mirrored door."),
  ],
  [
    "lit_mirror",
    "Lit Mirror",
    '["wall_face"]',
    desc("Bathroom or vanity mirror with integrated LED illumination."),
  ],
  [
    "wall_sconce",
    "Wall Sconce",
    '["wall_face"]',
    desc("Wall-mounted decorative or accent luminaire."),
  ],
  [
    "wall_mounted_faucet",
    "Wall-Mounted Faucet",
    '["wall_face"]',
    desc("Lavatory or sink faucet with in-wall rough-in valve and wall spout."),
  ],
  [
    "deck_mounted_faucet",
    "Deck-Mounted Faucet",
    '["wall_face"]',
    desc("Countertop or sink deck mounted faucet assembly."),
  ],
  [
    "rainfall_showerhead",
    "Rainfall Showerhead",
    '["ceiling"]',
    desc("Ceiling-mounted overhead rain shower fixture."),
  ],
  [
    "recessed_light",
    "Recessed Light",
    '["ceiling"]',
    desc("In-ceiling downlight housing and trim."),
  ],
  [
    "pendant_light",
    "Pendant Light",
    '["ceiling"]',
    desc("Ceiling-suspended light fixture."),
  ],
  [
    "ceiling_fan",
    "Ceiling Fan",
    '["ceiling"]',
    desc("Ceiling-mounted circulation fan with optional light kit."),
  ],
  [
    "recessed_curtain_track",
    "Recessed Curtain Track",
    '["ceiling"]',
    desc("Ceiling-integrated drapery or curtain track pocket."),
  ],
  [
    "curtain_rod",
    "Curtain Rod",
    '["wall_face"]',
    desc("Wall-mounted drapery hardware rod."),
  ],
  [
    "faceplate",
    "Faceplate",
    '["wall_face"]',
    desc("Electrical switch, outlet, or data wall plate."),
  ],
  [
    "under_cabinet_light",
    "Under-Cabinet Light",
    '["wall_face"]',
    desc("Underside cabinet task lighting luminaire or tape channel."),
  ],
  [
    "in_wall_safe",
    "In-Wall Safe",
    '["wall_face"]',
    desc("Recessed security safe installed between wall studs."),
  ],
];

// ── Fixture Requirements ─────────────────────────────────────────────────────
// requirement_kind ∈ blocking | electrical | plumbing | reinforcement | clearance | finish_coord
// blocks_assembly_close ∈ boolean (1 or 0)
const FIXTURE_REQUIREMENTS = [
  // tv_mount → blocking (1), electrical (1), clearance (0)
  [
    "tv_mount",
    "blocking",
    "Solid wood backing or 2x6 blocking between studs required to carry mount and display weight",
    true,
  ],
  [
    "tv_mount",
    "electrical",
    "Recessed power outlet and conduit/raceway at mounting height before wall closes",
    true,
  ],
  [
    "tv_mount",
    "clearance",
    "Verify viewing distance and surrounding clearance on finished wall",
    false,
  ],

  // floating_vanity → blocking (1), plumbing (1), finish_coord (1)
  [
    "floating_vanity",
    "blocking",
    "Heavy 2x8 or steel reinforced wall blocking required for vanity static and dynamic load",
    true,
  ],
  [
    "floating_vanity",
    "plumbing",
    "In-wall supply lines and drain stub-out positioned precisely for vanity cabinet alignment",
    true,
  ],
  [
    "floating_vanity",
    "finish_coord",
    "Wall tile or paint finish must extend seamlessly behind or meet vanity back edge",
    true,
  ],

  // medicine_cabinet → blocking (1), electrical (1)
  [
    "medicine_cabinet",
    "blocking",
    "Rough opening framing and perimeter blocking for recessed cabinet mounting",
    true,
  ],
  [
    "medicine_cabinet",
    "electrical",
    "Junction box and power feed for interior outlets, defogger, or integrated lighting",
    true,
  ],

  // lit_mirror → electrical (1), finish_coord (1)
  [
    "lit_mirror",
    "electrical",
    "In-wall power junction or driver location centered behind mirror mount",
    true,
  ],
  [
    "lit_mirror",
    "finish_coord",
    "Coordinate color temperature and driver dimming with room lighting controls",
    true,
  ],

  // wall_mounted_faucet → plumbing (1), clearance (1)
  [
    "wall_mounted_faucet",
    "plumbing",
    "In-wall rough-in valve body securely mounted and depth-set relative to finished wall face",
    true,
  ],
  [
    "wall_mounted_faucet",
    "clearance",
    "Coordinate spout projection with sink basin position and backsplash clearance",
    true,
  ],

  // rainfall_showerhead → blocking (1), plumbing (1)
  [
    "rainfall_showerhead",
    "blocking",
    "Ceiling joist blocking or drop-ear elbow support for heavy shower arm",
    true,
  ],
  [
    "rainfall_showerhead",
    "plumbing",
    "Ceiling plumbing supply drop and waterproofing integration above shower area",
    true,
  ],

  // recessed_curtain_track → finish_coord (1), blocking (1)
  [
    "recessed_curtain_track",
    "finish_coord",
    "Ceiling pocket dimension and alignment coordinated with drywall edge trim",
    true,
  ],
  [
    "recessed_curtain_track",
    "blocking",
    "Continuous ceiling blocking or channel support along full track length",
    true,
  ],

  // ceiling_fan → blocking (1), electrical (1)
  [
    "ceiling_fan",
    "blocking",
    "Fan-rated junction box attached to ceiling joist structure for dynamic loads",
    true,
  ],
  [
    "ceiling_fan",
    "electrical",
    "Dedicated switch leg or constant power feed for fan and light kit controls",
    true,
  ],

  // recessed_light → electrical (1), finish_coord (1)
  [
    "recessed_light",
    "electrical",
    "IC-rated / airtight housing wired to lighting circuit prior to drywall",
    true,
  ],
  [
    "recessed_light",
    "finish_coord",
    "Coordinate housing cutout location with ceiling joists, HVAC, and room layout",
    true,
  ],

  // under_cabinet_light → electrical (1)
  [
    "under_cabinet_light",
    "electrical",
    "Low-voltage wire run or junction box stub-out at upper cabinet underside height",
    true,
  ],

  // in_wall_safe → blocking (1), finish_coord (1)
  [
    "in_wall_safe",
    "blocking",
    "Header and stud framing rough opening to support safe enclosure weight",
    true,
  ],
  [
    "in_wall_safe",
    "finish_coord",
    "Ensure door swing clearance and flush wall trim coordination",
    true,
  ],
];

// ── Emit ────────────────────────────────────────────────────────────────────

const statements = [];

let sortOrder = 10;
for (const [key, name, unit, waste, d] of ASSEMBLY_LAYER_KIND_DEFS) {
  statements.push(
    `INSERT OR IGNORE INTO assembly_layer_kind_def (key, name, description_markdown, description_html, description_plaintext, takeoff_unit, default_waste_factor, sort_order, is_active) VALUES (${q(key)}, ${q(name)}, ${q(d.markdown)}, ${q(d.html)}, ${q(d.plaintext)}, ${q(unit)}, ${waste}, ${sortOrder}, 1);`,
  );
  sortOrder += 10;
}

sortOrder = 10;
for (const [key, name, appliesTo, d] of FIXTURE_TYPE_DEFS) {
  statements.push(
    `INSERT OR IGNORE INTO fixture_type_def (key, name, description_markdown, description_html, description_plaintext, applies_to_surface_kinds, sort_order, is_active) VALUES (${q(key)}, ${q(name)}, ${q(d.markdown)}, ${q(d.html)}, ${q(d.plaintext)}, ${q(appliesTo)}, ${sortOrder}, 1);`,
  );
  sortOrder += 10;
}

for (const [fixtureKey, reqKind, specText, blocksClose] of FIXTURE_REQUIREMENTS) {
  statements.push(
    `INSERT OR IGNORE INTO fixture_requirements (fixture_type_id, requirement_kind, spec, blocks_assembly_close) ` +
      `SELECT id, ${q(reqKind)}, ${q(specText)}, ${b(blocksClose)} FROM fixture_type_def WHERE key = ${q(fixtureKey)};`,
  );
}

// Chunking
const CHUNK = 20;
const chunks = [];
for (let i = 0; i < statements.length; i += CHUNK) {
  chunks.push(statements.slice(i, i + CHUNK));
}

console.log(
  `seed-surfaces: ${ASSEMBLY_LAYER_KIND_DEFS.length} assembly layer kinds, ${FIXTURE_TYPE_DEFS.length} fixture types, ${FIXTURE_REQUIREMENTS.length} fixture requirements = ${statements.length} statements in ${chunks.length} chunk(s)`,
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
console.log("seed-surfaces: done");
