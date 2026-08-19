#!/usr/bin/env node
/**
 * Seed the 0043 Phase 0 definition tables:
 *   - room_intent_type_def
 *   - material_type_def
 *   - room_type_def
 *   - room_use_def
 *
 * Usage:
 *   node scripts/seed-room-definitions.mjs            # dry run, prints SQL
 *   node scripts/seed-room-definitions.mjs --apply    # --remote
 *   node scripts/seed-room-definitions.mjs --apply --local
 *
 * Idempotent: every insert is INSERT OR IGNORE against a UNIQUE key.
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

// ── Room Intent Definitions ──────────────────────────────────────────────────
// scope_level ∈ OUT_OF_SCOPE | CONTIGUOUS_FINISH | TARGETED_UPDATE | FULL_REMODEL
const ROOM_INTENT_DEFS = [
  // key, name, scope_level, requires_full_spec, description
  [
    "OUT_OF_SCOPE",
    "Out of Scope",
    "OUT_OF_SCOPE",
    false,
    desc("The room is mapped for spatial continuity and context, but no work is being done here."),
  ],
  [
    "TARGETED_FIXTURE",
    "Targeted Fixture Swap",
    "TARGETED_UPDATE",
    false,
    desc("Swap out an existing fixture or appliance without disturbing surrounding room layout or major services."),
  ],
  [
    "SURFACE_REFRESH",
    "Surface Refresh",
    "CONTIGUOUS_FINISH",
    false,
    desc("Paint, refinish, or re-tile a surface while preserving the existing framing and layout."),
  ],
  [
    "IN_KIND",
    "In-Kind Replacement",
    "FULL_REMODEL",
    true,
    desc("Replace existing finishes and fixtures like-for-like in the same locations."),
  ],
  [
    "REPAIR",
    "Repair",
    "TARGETED_UPDATE",
    false,
    desc("Fix damaged or non-functional elements without upgrading or altering room layout."),
  ],
  [
    "WALL_LAYOUT_CHANGE",
    "Wall Layout Change",
    "FULL_REMODEL",
    true,
    desc("Move, remove, or add walls to reconfigure room boundaries or openings."),
  ],
  [
    "CEILING_MODIFICATION",
    "Ceiling Modification",
    "FULL_REMODEL",
    true,
    desc("Alter ceiling geometry or structure, such as vaulting, soffits, or coffers."),
  ],
  [
    "FENESTRATION_CHANGE",
    "Fenestration Change",
    "FULL_REMODEL",
    true,
    desc("Add, resize, or relocate windows or exterior doors."),
  ],
  [
    "MOVE_PLUMBING",
    "Move Plumbing",
    "FULL_REMODEL",
    true,
    desc("Relocate plumbing fixtures, supply lines, or drain locations."),
  ],
  [
    "MEP_CHANGE",
    "MEP Change",
    "FULL_REMODEL",
    true,
    desc("Modify mechanical, electrical, or plumbing infrastructure beyond basic fixture swaps."),
  ],
  [
    "INFILL",
    "Infill",
    "FULL_REMODEL",
    true,
    desc("Close an existing opening or absorb adjacent space into the room."),
  ],
  [
    "HORIZONTAL_ADDITION",
    "Horizontal Addition",
    "FULL_REMODEL",
    true,
    desc("Expand the home's footprint outward to create or extend room space."),
  ],
  [
    "VERTICAL_ADDITION",
    "Vertical Addition",
    "FULL_REMODEL",
    true,
    desc("Add or modify room space above or below an existing floor level."),
  ],
  [
    "DEMOLITION",
    "Demolition",
    "FULL_REMODEL",
    true,
    desc("Remove existing room structures, finishes, or elements prior to rebuilding."),
  ],
];

// ── Material Type Definitions ────────────────────────────────────────────────
// granularity ∈ room | wall | surface | project
// takeoff_unit ∈ sqft | linear_ft | each | gallons
const MATERIAL_TYPE_DEFS = [
  // key, name, granularity, unit, waste_factor, is_entire_floor, is_entire_home, description
  [
    "FLOORING",
    "Flooring",
    "room",
    "sqft",
    0.10,
    true,
    true,
    desc("Coverings applied across room floor surfaces such as hardwood, tile, carpet, or vinyl."),
  ],
  [
    "WALL_FINISH",
    "Wall Finish",
    "wall",
    "sqft",
    0.10,
    false,
    false,
    desc("Wall surface treatments such as drywall, paneling, wallpaper, or plaster."),
  ],
  [
    "PAINT",
    "Paint",
    "surface",
    "gallons",
    0.05,
    true,
    true,
    desc("Liquid coatings applied to walls, ceilings, and trim for color and surface protection."),
  ],
  [
    "BASEBOARD",
    "Baseboard",
    "room",
    "linear_ft",
    0.10,
    true,
    true,
    desc("Trim installed along the joint between floor and wall surfaces."),
  ],
  [
    "INTERIOR_DOOR",
    "Interior Door",
    "wall",
    "each",
    0.0,
    true,
    true,
    desc("Doors and door assemblies providing access between interior spaces."),
  ],
  [
    "WINDOW",
    "Window",
    "wall",
    "each",
    0.0,
    false,
    false,
    desc("Glazed openings in exterior walls for light, ventilation, and views."),
  ],
  [
    "LIGHTING",
    "Lighting",
    "room",
    "each",
    0.0,
    false,
    false,
    desc("Luminaires, recessed fixtures, pendants, and sconces providing illumination."),
  ],
  [
    "OUTLET",
    "Outlet",
    "wall",
    "each",
    0.0,
    false,
    false,
    desc("Electrical receptacles and switches installed on walls and surfaces."),
  ],
  [
    "TILE",
    "Tile",
    "surface",
    "sqft",
    0.15,
    false,
    false,
    desc("Ceramic, porcelain, or stone tiles applied to floors, walls, and wet areas."),
  ],
  [
    "COUNTERTOP",
    "Countertop",
    "surface",
    "sqft",
    0.10,
    false,
    false,
    desc("Horizontal work surfaces in kitchens, bathrooms, and utility spaces."),
  ],
  [
    "CABINETRY",
    "Cabinetry",
    "room",
    "each",
    0.0,
    false,
    false,
    desc("Storage cabinets, vanities, and built-in millwork."),
  ],
  [
    "PLUMBING_FIXTURE",
    "Plumbing Fixture",
    "room",
    "each",
    0.0,
    false,
    false,
    desc("Sinks, faucets, toilets, showers, and tubs connected to plumbing supply and drainage."),
  ],
];

// ── Room Type Definitions ────────────────────────────────────────────────────
// wet, dry, circulation, utility, outdoor
const ROOM_TYPE_DEFS = [
  // key, name, description
  [
    "wet",
    "Wet Room",
    desc("Spaces with direct water exposure requiring waterproofing, drainage, and specialized moisture protection."),
  ],
  [
    "dry",
    "Dry Room",
    desc("Standard interior living spaces without plumbing fixtures or high moisture requirements."),
  ],
  [
    "circulation",
    "Circulation Space",
    desc("Hallways, foyers, stairwells, and transition areas connecting rooms."),
  ],
  [
    "utility",
    "Utility Space",
    desc("Functional service areas housing building systems, laundry, or storage."),
  ],
  [
    "outdoor",
    "Outdoor Space",
    desc("Exterior living areas such as patios, decks, porches, and balconies."),
  ],
];

// ── Room Use Definitions ─────────────────────────────────────────────────────
// kitchen, primary_bath, guest_bath, hall_bath, bedroom, office, living_room,
// dining_room, family_room, laundry, garage, closet, hallway, stairwell, patio, backyard
const ROOM_USE_DEFS = [
  // key, name, description
  [
    "kitchen",
    "Kitchen",
    desc("Food preparation, cooking, and food storage area."),
  ],
  [
    "primary_bath",
    "Primary Bathroom",
    desc("Ensuite bathroom serving the primary bedroom suite."),
  ],
  [
    "guest_bath",
    "Guest Bathroom",
    desc("Full or half bathroom designated for guests."),
  ],
  [
    "hall_bath",
    "Hall Bathroom",
    desc("Bathroom accessible from shared hallways for general household use."),
  ],
  [
    "bedroom",
    "Bedroom",
    desc("Private sleeping room or personal living quarters."),
  ],
  [
    "office",
    "Home Office",
    desc("Dedicated work space, study, or home office."),
  ],
  [
    "living_room",
    "Living Room",
    desc("Primary seating and entertaining area near main entry."),
  ],
  [
    "dining_room",
    "Dining Room",
    desc("Dedicated area for household dining and meals."),
  ],
  [
    "family_room",
    "Family Room",
    desc("Informal secondary living space for daily relaxation and entertainment."),
  ],
  [
    "laundry",
    "Laundry Room",
    desc("Space for clothes washing, drying, and laundry storage."),
  ],
  [
    "garage",
    "Garage",
    desc("Vehicle storage and general workshop or utility area."),
  ],
  [
    "closet",
    "Closet",
    desc("Dedicated storage space for clothes, linens, or household goods."),
  ],
  [
    "hallway",
    "Hallway",
    desc("Connecting passage between rooms and building areas."),
  ],
  [
    "stairwell",
    "Stairwell",
    desc("Vertical circulation space containing stairs between floors."),
  ],
  [
    "patio",
    "Patio",
    desc("Outdoor paved or finished seating and entertaining area."),
  ],
  [
    "backyard",
    "Backyard",
    desc("Outdoor yard space behind or surrounding the home."),
  ],
];

// ── Emit ────────────────────────────────────────────────────────────────────

const statements = [];

let sortOrder = 10;
for (const [key, name, scopeLevel, requiresFullSpec, d] of ROOM_INTENT_DEFS) {
  statements.push(
    `INSERT OR IGNORE INTO room_intent_type_def (key, name, scope_level, requires_full_spec, description_markdown, description_html, description_plaintext, sort_order, is_active) VALUES (${q(key)}, ${q(name)}, ${q(scopeLevel)}, ${b(requiresFullSpec)}, ${q(d.markdown)}, ${q(d.html)}, ${q(d.plaintext)}, ${sortOrder}, 1);`,
  );
  sortOrder += 10;
}

sortOrder = 10;
for (const [key, name, granularity, unit, waste, floor, home, d] of MATERIAL_TYPE_DEFS) {
  statements.push(
    `INSERT OR IGNORE INTO material_type_def (key, name, scope_granularity, takeoff_unit, default_waste_factor, is_entire_floor_applicable, is_entire_home_applicable, description_markdown, description_html, description_plaintext, sort_order, is_active) VALUES (${q(key)}, ${q(name)}, ${q(granularity)}, ${q(unit)}, ${waste}, ${b(floor)}, ${b(home)}, ${q(d.markdown)}, ${q(d.html)}, ${q(d.plaintext)}, ${sortOrder}, 1);`,
  );
  sortOrder += 10;
}

sortOrder = 10;
for (const [key, name, d] of ROOM_TYPE_DEFS) {
  statements.push(
    `INSERT OR IGNORE INTO room_type_def (key, name, description_markdown, description_html, description_plaintext, sort_order, is_active) VALUES (${q(key)}, ${q(name)}, ${q(d.markdown)}, ${q(d.html)}, ${q(d.plaintext)}, ${sortOrder}, 1);`,
  );
  sortOrder += 10;
}

sortOrder = 10;
for (const [key, name, d] of ROOM_USE_DEFS) {
  statements.push(
    `INSERT OR IGNORE INTO room_use_def (key, name, description_markdown, description_html, description_plaintext, sort_order, is_active) VALUES (${q(key)}, ${q(name)}, ${q(d.markdown)}, ${q(d.html)}, ${q(d.plaintext)}, ${sortOrder}, 1);`,
  );
  sortOrder += 10;
}

// Chunking
const CHUNK = 20;
const chunks = [];
for (let i = 0; i < statements.length; i += CHUNK) {
  chunks.push(statements.slice(i, i + CHUNK));
}

console.log(
  `seed-room-definitions: ${ROOM_INTENT_DEFS.length} room intents, ${MATERIAL_TYPE_DEFS.length} material types, ${ROOM_TYPE_DEFS.length} room types, ${ROOM_USE_DEFS.length} room uses = ${statements.length} statements in ${chunks.length} chunk(s)`,
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
console.log("seed-room-definitions: done");
