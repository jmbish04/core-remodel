// Run: npx tsx scripts/tests/test_global_products.mjs
import assert from "node:assert";
import { execFileSync } from "node:child_process";

// Import real helper modules via dynamic import
const { normalizeModelKey } = await import("../../src/backend/lib/normalize-model.ts");
const { parsePriceCents, parseDiscountPct } = await import("../../src/backend/lib/money.ts");

/** Read-only query against local D1 via wrangler. */
function d1(q) {
  const out = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", "DB", "--local", "--json", `--command=${q}`],
    { encoding: "utf8" }
  );
  return JSON.parse(out)[0].results;
}

// --- Task 1: normalizeModelKey ---
assert.equal(normalizeModelKey("MS 604-01"), "MS60401");
assert.equal(normalizeModelKey("ms604"), "MS604");
assert.equal(normalizeModelKey("  "), null);
assert.equal(normalizeModelKey(null), null);
assert.equal(normalizeModelKey("#$%"), null);
// --- Task 1: parsePriceCents ---
assert.equal(parsePriceCents("$1,299.00"), 129900);
assert.equal(parsePriceCents("1299"), 129900);
assert.equal(parsePriceCents("$12.99"), 1299);
assert.equal(parsePriceCents("call for pricing"), null);
assert.equal(parsePriceCents(null), null);
// --- Task 1: parseDiscountPct ---
assert.equal(parseDiscountPct("15%"), 15);
assert.equal(parseDiscountPct("15% off"), 15);
assert.equal(parseDiscountPct("none"), null);
console.log("OK: helpers (normalizeModelKey, parsePriceCents, parseDiscountPct)");

// --- Task 5: backfill sanity (local D1) ---
const withPrice = d1(
  "SELECT count(*) c FROM showroom_store_products WHERE price IS NOT NULL AND trim(price) <> ''"
)[0].c;
const obs = d1(
  "SELECT count(*) c FROM product_price_observations WHERE source_type='showroom'"
)[0].c;
assert.ok(obs >= withPrice, `expected >= ${withPrice} observations, got ${obs}`);
const unmapped = d1(
  "SELECT count(*) c FROM showroom_store_products p WHERE p.store_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM showroom_product_mappings m WHERE m.showroom_id=p.store_id AND m.product_id=p.id)"
)[0].c;
assert.equal(unmapped, 0, "every product's store_id must be mapped");
console.log("OK: backfill (observations + mappings)");

// --- Task 5: real-data checks (2 priced products seeded from prod snapshot) ---
// obs count >= count of priced products. NOTE: post-Task-6 dedup, obs can exceed
// withPrice because a merged loser's showroom price observation is re-pointed onto
// the survivor product rather than collapsed (product_price_observations has no
// uniqueness constraint — it is intentionally "different prices found across
// showrooms", so the survivor legitimately ends up with >1 observation row).
assert.ok(obs >= withPrice, `expected obs count (${obs}) to be >= priced product count (${withPrice})`);
assert.equal(withPrice, 2, `expected 2 priced products in the local snapshot, got ${withPrice}`);

// Every numeric-looking text price must have a non-null price_cents.
const nullPriceCents = d1(
  "SELECT count(*) c FROM product_price_observations WHERE price IS NOT NULL AND price GLOB '*[0-9]*' AND price NOT GLOB '*[A-Za-z]*' AND price_cents IS NULL"
)[0].c;
assert.equal(nullPriceCents, 0, "numeric text prices must have a non-null price_cents");

// Keyed by observation id (not product_id) since post-Task-6 dedup a survivor
// product can carry more than one observation row (see the `obs >= withPrice`
// note above) — id=1/id=2 are the two original prod-snapshot observations.
const priceCentsById = Object.fromEntries(
  d1("SELECT id, price_cents FROM product_price_observations WHERE id IN (1,2)").map((r) => [
    r.id,
    r.price_cents,
  ])
);
assert.equal(priceCentsById[1], 269999, "observation 1 ($2,699.99, product 1) should parse to price_cents 269999");
assert.equal(priceCentsById[2], 144999, "observation 2 ($1,449.99, product 2) should parse to price_cents 144999");

// model_key derived from the numeric SKUs.
const modelKeys = Object.fromEntries(
  d1("SELECT id, model_key FROM showroom_store_products WHERE id IN (1,2)").map((r) => [
    r.id,
    r.model_key,
  ])
);
assert.equal(modelKeys[1], "1000110", "product 1 model_key should be derived from sku 1000110");
assert.equal(modelKeys[2], "1806208", "product 2 model_key should be derived from sku 1806208");

// Zero products whose store_id is unmapped (redundant with `unmapped` above, kept
// explicit per the real-data assertion list).
const unmappedStores = d1(
  "SELECT count(*) c FROM showroom_store_products p WHERE p.store_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM showroom_product_mappings m WHERE m.showroom_id=p.store_id AND m.product_id=p.id)"
)[0].c;
assert.equal(unmappedStores, 0, "every product's store_id must be mapped (real-data check)");

console.log(`OK: backfill real-data checks (obs=${obs}, price_cents=269999/144999, model_key=1000110/1806208, unmapped=0)`);

// --- Task 6: dedup integrity ---
const dupKeys = d1(
  "SELECT count(*) c FROM (SELECT brand_id, model_key FROM showroom_store_products WHERE model_key IS NOT NULL GROUP BY brand_id, model_key HAVING count(*) > 1)"
)[0].c;
assert.equal(dupKeys, 0, "no duplicate (brand_id, model_key) may remain");
const orphanObs = d1(
  "SELECT count(*) c FROM product_price_observations o WHERE NOT EXISTS (SELECT 1 FROM showroom_store_products p WHERE p.id=o.product_id)"
)[0].c;
assert.equal(orphanObs, 0, "no orphaned observations");
console.log("OK: dedup integrity");

// --- Task 6: concrete re-pointing checks (synthetic loser id=90001 -> survivor id=1) ---
const productIds = d1("SELECT id FROM showroom_store_products WHERE id IN (1,2,90001)").map(
  (r) => r.id
);
assert.ok(!productIds.includes(90001), "loser product 90001 must no longer exist");
assert.ok(productIds.includes(1), "survivor product 1 must still exist");
assert.ok(productIds.includes(2), "unrelated product 2 must still exist");

const orphanPhotos = d1(
  "SELECT count(*) c FROM product_showroom_photos o WHERE NOT EXISTS (SELECT 1 FROM showroom_store_products p WHERE p.id=o.product_id)"
)[0].c;
assert.equal(orphanPhotos, 0, "no orphaned showroom photos");

// product_id-keyed child rows (id=90001) re-pointed to survivor id=1.
const ppo = d1("SELECT product_id FROM product_price_observations WHERE id=90001")[0];
assert.equal(ppo?.product_id, 1, "product_price_observations id=90001 must re-point to product_id=1");
const pmm = d1("SELECT product_id FROM product_material_mappings WHERE id=90001")[0];
assert.equal(pmm?.product_id, 1, "product_material_mappings id=90001 must re-point to product_id=1");
const psp = d1("SELECT product_id FROM product_showroom_photos WHERE id=90001")[0];
assert.equal(psp?.product_id, 1, "product_showroom_photos id=90001 must re-point to product_id=1");

// store_product_id-keyed child rows (id=90001) re-pointed to survivor id=1.
const spn = d1("SELECT store_product_id FROM store_product_notes WHERE id=90001")[0];
assert.equal(spn?.store_product_id, 1, "store_product_notes id=90001 must re-point to store_product_id=1");
const pi = d1("SELECT store_product_id FROM product_images WHERE id=90001")[0];
assert.equal(pi?.store_product_id, 1, "product_images id=90001 must re-point to store_product_id=1");
const spr = d1("SELECT store_product_id FROM store_product_rating WHERE id=90001")[0];
assert.equal(spr?.store_product_id, 1, "store_product_rating id=90001 must re-point to store_product_id=1");

// plain-column re-point.
const msi = d1(
  "SELECT purchased_showroom_product_id FROM material_schedule_items WHERE id=90001"
)[0];
assert.equal(
  msi?.purchased_showroom_product_id,
  1,
  "material_schedule_items id=90001 must re-point purchased_showroom_product_id to 1"
);

// showroom_product_mappings: product 1 has EXACTLY ONE row for showroom 41 (the
// duplicate (41,90001) row must have collapsed away, not merely re-pointed).
const survivorMappings = d1(
  "SELECT id FROM showroom_product_mappings WHERE showroom_id=41 AND product_id=1"
);
assert.equal(
  survivorMappings.length,
  1,
  `expected exactly 1 mapping row for (showroom=41, product=1), got ${survivorMappings.length}`
);
const staleMapping = d1(
  "SELECT count(*) c FROM showroom_product_mappings WHERE showroom_id=41 AND product_id=90001"
)[0].c;
assert.equal(staleMapping, 0, "the (showroom=41, product=90001) mapping row must be gone");

console.log(
  "OK: dedup re-pointing (90001 gone, product 1/2 intact, child rows re-pointed, mapping collapsed, orphans=0)"
);
