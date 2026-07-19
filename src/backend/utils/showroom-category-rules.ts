/**
 * @fileoverview PURE showroom category classification rules.
 *
 * Split out from `showroom-categories.ts` (which owns D1 persistence) so the
 * rules can be unit-tested with plain `node` — that file imports drizzle and the
 * schema barrel, which a bare node process cannot resolve through the `@backend`
 * alias. Nothing here imports anything.
 *
 * Maps free-text signal tokens onto the internal showroom category vocabulary,
 * then writes `showroom_store_category_mapping` rows — FILL-BLANKS ONLY (a store
 * that already has any category mapping is left untouched).
 *
 * TOKENS ARE NOT GOOGLE-SPECIFIC. This used to be fed exclusively by Google
 * Places `types`/`primaryType`. It now takes any text: the store NAME (by far the
 * strongest signal — "Archetype Lighting", "Tez Marble", "Tileshop"), the
 * description, mapped brand names, and scraped page text. Places is no longer
 * required for a store to get categorised.
 *
 * WHY THIS FILE WAS REWRITTEN (2026-07-16). The rule table emitted labels from an
 * OLDER category vocabulary and was never updated when the live vocabulary
 * changed, while resolution used a fuzzy bidirectional `includes` match that hid
 * the breakage. Measured against the live 28-row `showroom_store_category` table:
 *
 *   - 15 of 19 emitted labels resolved to NOTHING ("Plumbing Fixtures",
 *     "Kitchen Cabinetry", "Appliances", "Closet Systems", "Smart Home", …).
 *   - The 4 that did resolve were WRONG: the single rule `/tile|stone|flooring/`
 *     emitted "Flooring", which fuzzy-matched "Hardwood & Flooring Specialists",
 *     so every tile and stone yard in the directory was filed as a hardwood
 *     flooring specialist. "Tileshop", "Art Tile", "All Natural Stone" and
 *     "Italics Tile & Stone" all landed there.
 *
 * That is why 86 of 146 stores carried zero categories.
 *
 * TWO STRUCTURAL FIXES so it cannot silently rot again:
 *   1. Rules emit CANONICAL_CATEGORIES members — the exact live names — and the
 *      type system rejects any other string at compile time.
 *   2. Resolution is an EXACT case-insensitive name match. The old fuzzy contains
 *      match is what let "Flooring" swallow "Hardwood & Flooring Specialists".
 *
 * `scripts/tests/test_showroom_categories.mjs` asserts every rule label is a real
 * category and pins the classification of real store names.
 */

/**
 * The live `showroom_store_category.name` vocabulary (28 rows, is_active = 1).
 *
 * Duplicated here deliberately: it makes the rule table compile-time checked
 * against reality, so a rule can never again emit a label that no category has.
 * If the DB vocabulary changes, this list and the rules must change with it —
 * the category test fails loudly when they drift.
 */
export const CANONICAL_CATEGORIES = [
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
] as const;

export type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number];

/**
 * Ordered rules mapping signal tokens to canonical category names. Each rule
 * tests the combined lowercased haystack; every match contributes its labels,
 * de-duplicated in insertion order.
 *
 * `labels` is typed `CanonicalCategory[]`, so a typo or a stale vocabulary entry
 * is a COMPILE ERROR rather than a silently dead rule.
 *
 * Ordering matters for specificity: stone/tile rules come before the generic
 * flooring rule so a marble yard is a stone yard, not a hardwood specialist.
 */
const CATEGORY_RULES: { test: RegExp; labels: CanonicalCategory[] }[] = [
  // ── Stone & tile — the two most common showroom types, and the two the old
  //    table collapsed into "Flooring". Specific rules FIRST.
  {
    test: /\bslab|granite|quartzite|quartz\b|marble|soapstone|onyx|travertine|natural stone|stone yard|stoneworks?\b/,
    labels: ["Slab & Natural Stone Yards"],
  },
  { test: /\btile|mosaic|porcelain|ceramic|terracotta|zellige|backsplash/, labels: ["Tile & Surfaces Showrooms"] },
  // Bare "stone" (e.g. "Carmel Stone Imports") — after the specific rules.
  { test: /\bstone\b/, labels: ["Slab & Natural Stone Yards"] },

  // Countertop fabricators sit with the slab yards (e.g. "Bay Countertops").
  { test: /countertops?\b|fabricat(or|ion) (shop|of stone)/, labels: ["Slab & Natural Stone Yards", "Kitchen & Custom Cabinetry"] },
  // "Surfaces" is the trade word for the tile/slab category ("MARVEL SURFACES").
  { test: /\bsurfaces?\b/, labels: ["Tile & Surfaces Showrooms"] },

  // ── Plumbing & bath
  { test: /plumbing|plumber|faucet|bathtub|shower system|sanitary|toilet|lavatory|\bbath\b|bathroom|ferguson/, labels: ["Plumbing & Bath Supply"] },

  // ── Kitchen & cabinetry
  { test: /kitchen|cabinet|cabinetry|millwork|closets? & cabinet/, labels: ["Kitchen & Custom Cabinetry"] },

  // ── Closets & storage
  { test: /closet|wardrobe|storage system|organiz|\bpax\b|walk-in/, labels: ["Closet & Wardrobe Systems"] },

  // ── Appliances
  { test: /appliance|sub-?zero|wolf\b|thermador|viking range/, labels: ["Appliance Galleries"] },

  // ── Flooring (hardwood/carpet ONLY — tile & stone handled above)
  { test: /hardwood|wood floor|floor(ing)?\b|carpet|vinyl plank|laminate|parquet/, labels: ["Hardwood & Flooring Specialists"] },

  // ── Lighting
  { test: /lighting|light fixture|lamps?\b|chandelier|sconce|luminaire|city lights/, labels: ["Lighting Showrooms"] },

  // ── Windows & doors
  { test: /window(?!s? treatment)|\bdoors?\b|fenestration|entry system|garage door/, labels: ["Windows & Doors Dealerships"] },

  // ── Hardware
  { test: /hardware|knobs?|pulls?\b|hinge|door hardware|architectural fitting|ironmonger/, labels: ["Hardware & Architectural Fittings"] },

  // ── Paint, plaster, coatings
  { test: /paint|plaster|coating|venetian|microcement|micro-?topping|stucco|limewash|benjamin moore|sherwin/, labels: ["Paint, Plaster & Specialty Coatings"] },

  // ── Concrete & cast stone
  { test: /concrete|cast stone|terrazzo|gfrc|topcret|duraamen/, labels: ["Architectural Concrete & Cast Stone"] },

  // ── Glass & shower enclosures
  { test: /shower (enclosure|door)|glass (shop|works|company)|frameless/, labels: ["Glass & Shower Enclosures"] },

  // ── Home automation / AV
  { test: /home automation|smart home|audio ?visual|\ba\/?v\b|home theater|control4|lutron/, labels: ["Home Automation & A/V"] },

  // ── Landscape & hardscape
  { test: /landscap|garden|nursery|patio|hardscape|paver|outdoor living|deck(ing)?\b/, labels: ["Landscape & Exterior Hardscape"] },

  // ── Roofing & exterior
  { test: /roofing|\broof\b|siding|gutter|exterior cladding|facade/, labels: ["Roofing & Exterior Materials"] },

  // ── Electrical & mechanical
  { test: /electrical supply|\bhvac\b|mechanical supply|heating & air|furnace/, labels: ["Electrical & Mechanical Supply"] },

  // ── Decor, furniture, textiles
  { test: /furniture|home decor|\bdecor\b|textile|fabric|upholster|drapery fabric|\brugs?\b|interiors?\b|poliform|showroom design/, labels: ["Home Decor, Furniture & Textiles"] },

  // ── Big-box / general
  { test: /home improvement|home depot|lowe'?s|\bikea\b|general building|costco|warehouse club|members-only warehouse/, labels: ["General Home Improvement Centers"] },

  // ── Lumber & building materials
  { test: /lumber|building (supply|materials?)|timber|plywood|building center/, labels: ["Lumber, Millwork & Building Materials"] },

  // ── Pool & spa
  { test: /\bpool\b|\bspa\b|sauna|hot tub|steam room/, labels: ["Pool & Spa Supply"] },

  // ── Fireplaces
  { test: /fireplace|hearth|wood stove|chimney/, labels: ["Fireplaces & Hearths"] },

  // ── Elevators
  { test: /elevator|home lift|dumbwaiter/, labels: ["Elevators & Home Lifts"] },

  // ── Acoustics
  { test: /acoustic|soundproof|sound isolation|insensation/, labels: ["Acoustic & Soundproofing Solutions"] },

  // ── Metalwork
  { test: /metalwork|steel\b|wrought iron|blacksmith|fabrication|welding|masonry/, labels: ["Metalwork & Custom Fabrication"] },

  // ── Stairs & railings
  { test: /stair(case|s)?\b|railing|banister|balustrade/, labels: ["Staircases & Railing Systems"] },

  // ── Window treatments
  { test: /window treatment|\bshades?\b|\bblinds?\b|drapery|curtain|shutters?\b|motorized shade/, labels: ["Window Treatments & Shading"] },

  // ── Smart glass
  { test: /smart film|switchable glass|electrochromic|privacy glass/, labels: ["Smart Film & Switchable Glass"] },
];

/**
 * Infer internal showroom category NAMES from a set of signal tokens (Google
 * place types, primaryType, AI-insight brand type strings).
 *
 * @param tokens Raw signal strings; joined + lowercased into one haystack.
 * @returns De-duplicated internal category names (insertion order). May be empty.
 */
export function inferCategoryLabelsFromTokens(tokens: Array<string | null | undefined>): string[] {
  const haystack = tokens.filter(Boolean).join(" ").toLowerCase();
  if (!haystack.trim()) return [];
  const out: string[] = [];
  for (const { test, labels } of CATEGORY_RULES) {
    if (test.test(haystack)) {
      for (const label of labels) {
        if (!out.includes(label)) out.push(label);
      }
    }
  }
  return out;
}
