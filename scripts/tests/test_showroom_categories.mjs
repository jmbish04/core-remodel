#!/usr/bin/env node
/**
 * Pins showroom category inference against the LIVE vocabulary.
 *
 * This exists because the rule table silently rotted. Measured 2026-07-16
 * against the live 28-row `showroom_store_category`:
 *   - 15 of 19 emitted labels resolved to NOTHING
 *   - the 4 survivors were WRONG: `/tile|stone|flooring/` emitted "Flooring",
 *     which the old fuzzy `includes` resolver bound to "Hardwood & Flooring
 *     Specialists" — so Tileshop, Art Tile, All Natural Stone and Italics Tile
 *     & Stone were all filed as hardwood flooring specialists.
 * Result: 86 of 146 stores had zero categories.
 *
 * Two invariants, both of which would have caught it:
 *   1. Every label a rule can emit IS a real category name.
 *   2. Real store names classify to the right category.
 *
 * Usage: node scripts/tests/test_showroom_categories.mjs  |  pnpm run test:cats
 */
import assert from "node:assert/strict";

import {
  CANONICAL_CATEGORIES,
  inferCategoryLabelsFromTokens,
} from "../../src/backend/utils/showroom-category-rules.ts";

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
    process.exitCode = 1;
  }
}

/**
 * The live vocabulary, as read from prod D1 on 2026-07-16.
 * If this drifts from CANONICAL_CATEGORIES, inference is silently degrading.
 */
const LIVE_VOCABULARY = [
  "Slab & Natural Stone Yards",
  "Tile & Surfaces Showrooms",
  "Plumbing & Bath Supply",
  "Kitchen & Custom Cabinetry",
  "Closet & Wardrobe Systems",
  "Appliance Galleries",
  "Hardwood & Flooring Specialists",
  "Lighting Showrooms",
  "Windows & Doors Dealerships",
  "Hardware & Architectural Fittings",
  "Paint, Plaster & Specialty Coatings",
  "Architectural Concrete & Cast Stone",
  "Glass & Shower Enclosures",
  "Home Automation & A/V",
  "Landscape & Exterior Hardscape",
  "Roofing & Exterior Materials",
  "Electrical & Mechanical Supply",
  "Home Decor, Furniture & Textiles",
  "General Home Improvement Centers",
  "Lumber, Millwork & Building Materials",
  "Pool & Spa Supply",
  "Fireplaces & Hearths",
  "Elevators & Home Lifts",
  "Acoustic & Soundproofing Solutions",
  "Metalwork & Custom Fabrication",
  "Staircases & Railing Systems",
  "Window Treatments & Shading",
  "Smart Film & Switchable Glass",
];

console.log("\nvocabulary integrity — the invariant that broke");

check("CANONICAL_CATEGORIES matches the live DB vocabulary exactly", () => {
  assert.deepEqual([...CANONICAL_CATEGORIES].sort(), [...LIVE_VOCABULARY].sort());
});

check("every label any rule can emit is a real category (no dead labels)", () => {
  // Exercise a broad haystack so most rules fire, then assert every emitted
  // label is resolvable. Under the old table 15/19 emitted labels were dead.
  const kitchenSink = [
    "marble granite quartzite slab stone yard",
    "tile mosaic porcelain ceramic backsplash",
    "plumbing faucet bathtub shower bathroom",
    "kitchen cabinet cabinetry millwork",
    "closet wardrobe storage organizer pax",
    "appliance sub-zero thermador",
    "hardwood flooring carpet vinyl plank",
    "lighting chandelier sconce lamp",
    "window door fenestration garage door",
    "hardware knobs pulls hinge",
    "paint plaster coating venetian stucco",
    "concrete cast stone terrazzo",
    "shower enclosure frameless glass works",
    "home automation smart home lutron a/v",
    "landscape garden nursery patio paver",
    "roofing siding gutter facade",
    "electrical supply hvac furnace",
    "furniture decor textile fabric rugs interiors",
    "home improvement ikea",
    "lumber building supply timber plywood",
    "pool spa sauna hot tub",
    "fireplace hearth chimney",
    "elevator home lift dumbwaiter",
    "acoustic soundproof",
    "metalwork wrought iron fabrication masonry",
    "staircase railing balustrade",
    "window treatment shades blinds drapery",
    "smart film switchable glass electrochromic",
  ];
  const emitted = new Set();
  for (const h of kitchenSink) for (const l of inferCategoryLabelsFromTokens([h])) emitted.add(l);
  assert.ok(emitted.size > 0, "no labels emitted at all");
  const dead = [...emitted].filter((l) => !LIVE_VOCABULARY.includes(l));
  assert.deepEqual(dead, [], `dead labels: ${dead.join(", ")}`);
});

console.log("\nthe specific mis-filings that were live in prod");

const only = (name) => inferCategoryLabelsFromTokens([name]);

check("Tileshop is TILE, not hardwood flooring", () => {
  const l = only("Tileshop");
  assert.ok(l.includes("Tile & Surfaces Showrooms"), `got ${JSON.stringify(l)}`);
  assert.ok(!l.includes("Hardwood & Flooring Specialists"), `still hardwood: ${JSON.stringify(l)}`);
});

check("All Natural Stone is a STONE YARD, not hardwood flooring", () => {
  const l = only("All Natural Stone");
  assert.ok(l.includes("Slab & Natural Stone Yards"), `got ${JSON.stringify(l)}`);
  assert.ok(!l.includes("Hardwood & Flooring Specialists"), `still hardwood: ${JSON.stringify(l)}`);
});

check("Italics Tile & Stone hits BOTH tile and stone", () => {
  const l = only("Italics Tile & Stone");
  assert.ok(l.includes("Tile & Surfaces Showrooms"), `got ${JSON.stringify(l)}`);
  assert.ok(l.includes("Slab & Natural Stone Yards"), `got ${JSON.stringify(l)}`);
});

check("Tez Marble / Roman Marble Shop / Carmel Stone Imports are stone yards", () => {
  for (const n of ["Tez Marble", "Roman Marble Shop", "Carmel Stone Imports"]) {
    assert.ok(only(n).includes("Slab & Natural Stone Yards"), `${n} -> ${JSON.stringify(only(n))}`);
  }
});

console.log("\nstores that previously classified to NOTHING");

check("California Closets / Closet Factory -> closets", () => {
  for (const n of ["California Closets", "Closet Factory"]) {
    assert.ok(only(n).includes("Closet & Wardrobe Systems"), `${n} -> ${JSON.stringify(only(n))}`);
  }
});

check("SF City Lights -> lighting", () => {
  assert.ok(only("SF City Lights").includes("Lighting Showrooms"));
});

check("Concreteworks / Duraamen / Topcret -> architectural concrete", () => {
  for (const n of ["Concreteworks", "Duraamen", "Topcret (San Jose)"]) {
    assert.ok(
      only(n).includes("Architectural Concrete & Cast Stone"),
      `${n} -> ${JSON.stringify(only(n))}`,
    );
  }
});

check("East Star Building Supply -> lumber/building materials", () => {
  assert.ok(only("East Star Building Supply").includes("Lumber, Millwork & Building Materials"));
});

check("IKEA PAX -> closets + general improvement", () => {
  const l = only("IKEA PAX");
  assert.ok(l.includes("Closet & Wardrobe Systems"), `got ${JSON.stringify(l)}`);
});

check("Insensation Inc. -> acoustic", () => {
  assert.ok(only("Insensation Inc.").includes("Acoustic & Soundproofing Solutions"));
});

console.log("\nprecision — the cost of a greedy rule is a wrong category");

check("a lighting store is NOT a flooring specialist", () => {
  assert.ok(!only("Archetype Lighting").includes("Hardwood & Flooring Specialists"));
});

check("a plumbing supply is NOT a stone yard", () => {
  const l = only("Saratoga Plumbing Supply");
  assert.ok(l.includes("Plumbing & Bath Supply"), `got ${JSON.stringify(l)}`);
  assert.ok(!l.includes("Slab & Natural Stone Yards"), `got ${JSON.stringify(l)}`);
});

check("'Window Treatments' does not also mean windows & doors", () => {
  // The windows rule uses a negative lookahead precisely for this.
  const l = only("Bay Window Treatments & Shading");
  assert.ok(l.includes("Window Treatments & Shading"), `got ${JSON.stringify(l)}`);
  assert.ok(!l.includes("Windows & Doors Dealerships"), `got ${JSON.stringify(l)}`);
});

check("empty / junk tokens yield nothing (never guess)", () => {
  assert.deepEqual(inferCategoryLabelsFromTokens([]), []);
  assert.deepEqual(inferCategoryLabelsFromTokens([null, undefined, "  "]), []);
  assert.deepEqual(inferCategoryLabelsFromTokens(["zzzz qqqq"]), []);
});

console.log(`\n${process.exitCode ? "FAILED" : "PASSED"} — ${passed} checks\n`);
