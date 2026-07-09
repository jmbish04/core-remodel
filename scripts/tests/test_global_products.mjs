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
// obs count == count of priced products
assert.equal(obs, withPrice, `expected obs count (${obs}) to equal priced product count (${withPrice})`);
assert.equal(withPrice, 2, `expected 2 priced products in the local snapshot, got ${withPrice}`);

// Every numeric-looking text price must have a non-null price_cents.
const nullPriceCents = d1(
  "SELECT count(*) c FROM product_price_observations WHERE price IS NOT NULL AND price GLOB '*[0-9]*' AND price NOT GLOB '*[A-Za-z]*' AND price_cents IS NULL"
)[0].c;
assert.equal(nullPriceCents, 0, "numeric text prices must have a non-null price_cents");

const priceCentsByProduct = Object.fromEntries(
  d1("SELECT product_id, price_cents FROM product_price_observations ORDER BY product_id").map(
    (r) => [r.product_id, r.price_cents]
  )
);
assert.equal(priceCentsByProduct[1], 269999, "product 1 ($2,699.99) should parse to price_cents 269999");
assert.equal(priceCentsByProduct[2], 144999, "product 2 ($1,449.99) should parse to price_cents 144999");

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

console.log("OK: backfill real-data checks (obs=2, price_cents=269999/144999, model_key=1000110/1806208, unmapped=0)");
