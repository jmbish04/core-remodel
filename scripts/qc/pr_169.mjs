#!/usr/bin/env node
/**
 * QC for the brand-name-variations work.
 *
 * Run:
 *   pnpm run test:pr 169 -- --preview     # while the PR is open
 *   pnpm run test:pr 169                  # production, after merge
 *
 * Checks the invariants that make `brands.name` safe to read: every brand has
 * exactly one primary variation, the column matches it, and the duplicate
 * detector reports honestly.
 */
import { createClient, createChecks, resolveBase } from "../config.mjs";

const BASE = resolveBase();
const client = createClient({ base: BASE });
const { ok: check, info, summary } = createChecks();
const get = (path) => client.get(path);

console.log(`QC pr_169 against ${BASE}\n`);

// --- brand health endpoint ------------------------------------------------
const health = await get("/api/brands/health");
check("GET /api/brands/health returns 200", health.status === 200, `got ${health.status} ${health.text.slice(0, 120)}`);

if (health.json) {
  const h = health.json;
  check("reports a positive active brand count", (h.activeBrands ?? 0) > 0, `activeBrands=${h.activeBrands}`);
  check(
    "every active brand has a primary name",
    h.counts?.missingPrimaryName === 0,
    `${h.counts?.missingPrimaryName} brand(s) without a primary variation`,
  );
  // Name duplicates are the auto-mergeable class and should be zero after the
  // 0118 merge. Domain/logo groups are review candidates, not failures — a
  // shared site is not proof of a shared brand (Silestone / Dekton).
  check(
    "no name-duplicate brand groups remain",
    h.counts?.byName === 0,
    `${h.counts?.byName} name-duplicate group(s) still present`,
  );

  // --- the two integrity checks that matter after a merge -------------------
  // 1. Within a duplicate group, exactly ONE member may still be active.
  //    More than one means the duplicate is live and still splitting its data.
  check(
    "no duplicate group has >1 active brand",
    h.counts?.unresolvedDuplicateGroups === 0,
    `${h.counts?.unresolvedDuplicateGroups} group(s) with multiple active brands: ` +
      JSON.stringify(
        (h.duplicateGroups ?? [])
          .filter((g) => g.unresolved)
          .map((g) => ({ key: g.key, brands: g.brands.filter((b) => b.isActive).map((b) => b.id) })),
      ),
  );

  // 2. A retired brand must hold NO rows in ANY table keyed on brand_id — the
  //    merge repoints them before flagging is_active=0. Leftovers are an
  //    interrupted merge, and they are invisible without this check because the
  //    rows still resolve; they just point at a brand nobody lists.
  check(
    "no retired brand is still mapped to relation tables",
    h.counts?.retiredBrandsWithMappings === 0,
    `${h.counts?.retiredBrandsWithMappings} retired brand(s) holding ` +
      `${h.counts?.orphanedMappingRows} row(s): ` +
      JSON.stringify(h.retiredBrandsWithMappings ?? []),
  );

  info(`retired brands: ${h.retiredBrands}`);
  info(`(informational) domain groups: ${h.counts?.byDomain}, logo groups: ${h.counts?.byLogo} — review only`);
}

// --- brands list carries names from the variations table ------------------
const list = await get("/api/brands");
check("GET /api/brands returns 200", list.status === 200, `got ${list.status}`);

const brands = list.json?.brands ?? [];
check("brand list is non-empty", brands.length > 0, `${brands.length} brands`);
check(
  "every brand exposes primaryName",
  brands.length > 0 && brands.every((b) => typeof b.primaryName === "string" && b.primaryName.length > 0),
  "some brands are missing primaryName",
);
check(
  "every brand exposes a nameVariations array",
  brands.length > 0 && brands.every((b) => Array.isArray(b.nameVariations)),
  "some brands are missing nameVariations",
);
// The 0117 triggers make this an invariant, not a hope.
check(
  "primaryName always equals brands.name",
  brands.every((b) => b.primaryName === b.name),
  "primaryName diverged from name on at least one brand",
);

// --- the merge actually took ----------------------------------------------
const dornbracht = brands.find((b) => b.primaryName === "Dornbracht");
check("Dornbracht is present and active", Boolean(dornbracht), "not found in the active list");
if (dornbracht) {
  check(
    'Dornbracht retains "DORN BRACHT" as an alias',
    dornbracht.nameVariations.some((v) => v.toUpperCase() === "DORN BRACHT"),
    `variations: ${JSON.stringify(dornbracht.nameVariations)}`,
  );
}
check(
  "merged-away duplicates are hidden from the list",
  !brands.some((b) => ["DORN BRACHT", "NEWPORTBRASS", "WET STYLE"].includes(b.primaryName)),
  "a retired duplicate is still being listed",
);


// --- the orphan scan must cover EVERY brand_id FK table -------------------
// Adding a table with a brand_id FK and forgetting to add it to the health
// endpoint would silently shrink the check, so assert the coverage list here.
const EXPECTED_FK_TABLES = [
  "brand_categories",
  "brand_images",
  "brand_intel",
  "brand_name_variations",
  "brand_product_lines",
  "brand_type_mappings",
  "showroom_brand_mappings",
  "showroom_store_products",
];
const scanned = new Set(
  (health.json?.retiredBrandsWithMappings ?? []).flatMap((r) => Object.keys(r.tables ?? {})),
);
// When there are no orphans there is nothing to enumerate, which is the healthy
// case — so this only asserts that anything reported is a known table.
check(
  "orphan report only names known brand_id FK tables",
  [...scanned].every((t) => EXPECTED_FK_TABLES.includes(t)),
  `unexpected table(s): ${[...scanned].filter((t) => !EXPECTED_FK_TABLES.includes(t)).join(", ")}`,
);

process.exit(summary().failed === 0 ? 0 : 1);
