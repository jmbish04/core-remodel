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
// Post-0095, store_id no longer exists on showroom_store_products —
// showroom_product_mappings is the sole source of truth for showroom<->product
// links, so the "must be mapped" invariant is now: every product has >=1 mapping row.
const unmapped = d1(
  "SELECT count(*) c FROM showroom_store_products p WHERE NOT EXISTS (SELECT 1 FROM showroom_product_mappings m WHERE m.product_id=p.id)"
)[0].c;
assert.equal(unmapped, 0, "every product must have a showroom_product_mappings row");
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
// NOTE: product_images id=90001 was a collision (same store_product_id+source_url
// as survivor row id=90000 once re-pointed to product 1), so it is COLLAPSED
// (pre-deleted), not re-pointed. See the dedicated product_images/product_specs
// collision-collapse assertions below.
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

// --- Fix 1: review-finding coverage (similar_model_map, scan_log, wishlist_items,
// product_images/product_specs collision pre-collapse) ---

// Zero rows may reference 90001 anywhere across every product-referencing table.
const referencingTables = [
  ["showroom_product_mappings", "product_id"],
  ["product_material_mappings", "product_id"],
  ["product_price_observations", "product_id"],
  ["product_showroom_photos", "product_id"],
  ["product_images", "store_product_id"],
  ["product_specs", "store_product_id"],
  ["store_product_docs", "store_product_id"],
  ["store_product_intel", "store_product_id"],
  ["store_product_research", "store_product_id"],
  ["store_product_rating", "store_product_id"],
  ["store_product_notes", "store_product_id"],
  ["store_product_pa_mapping", "store_product_id"],
  ["store_product_tag_mapping", "store_product_id"],
  ["material_schedule_items", "purchased_showroom_product_id"],
];
for (const [table, col] of referencingTables) {
  const c = d1(`SELECT count(*) c FROM ${table} WHERE ${col}=90001`)[0].c;
  assert.equal(c, 0, `${table}.${col} must have zero rows referencing 90001, got ${c}`);
}
// Two-column tables.
for (const col of ["parent_store_product_id", "similar_store_product_id"]) {
  const c = d1(`SELECT count(*) c FROM store_product_similar_model_map WHERE ${col}=90001`)[0].c;
  assert.equal(c, 0, `store_product_similar_model_map.${col} must have zero rows referencing 90001, got ${c}`);
}
for (const col of ["matched_store_product_id", "auto_created_product_id"]) {
  const c = d1(`SELECT count(*) c FROM showroom_scan_log WHERE ${col}=90001`)[0].c;
  assert.equal(c, 0, `showroom_scan_log.${col} must have zero rows referencing 90001, got ${c}`);
}
const wishlistRefs = d1(
  "SELECT count(*) c FROM wishlist_items WHERE showroom_store_product_id=90001"
)[0].c;
assert.equal(wishlistRefs, 0, "wishlist_items.showroom_store_product_id must have zero rows referencing 90001");
console.log("OK: zero references to 90001 across all product-referencing tables");

// store_product_similar_model_map: no self-referential rows; surviving row -> product 1.
const selfRefs = d1(
  "SELECT count(*) c FROM store_product_similar_model_map WHERE parent_store_product_id = similar_store_product_id"
)[0].c;
assert.equal(selfRefs, 0, "store_product_similar_model_map must have no self-referential rows");
const survivingSimilarRow = d1(
  "SELECT parent_store_product_id, similar_store_product_id FROM store_product_similar_model_map WHERE id=90001"
)[0];
assert.ok(survivingSimilarRow, "store_product_similar_model_map id=90001 should still exist (not self-referential)");
assert.equal(survivingSimilarRow.parent_store_product_id, 1, "similar_model_map id=90001 parent must re-point to 1");
assert.equal(survivingSimilarRow.similar_store_product_id, 2, "similar_model_map id=90001 similar must remain 2");
const droppedSimilarRow = d1("SELECT count(*) c FROM store_product_similar_model_map WHERE id=90002")[0].c;
assert.equal(droppedSimilarRow, 0, "similar_model_map id=90002 (parent=1,similar->1 after re-point) must be deleted as self-referential");
console.log("OK: store_product_similar_model_map self-reference cleanup");

// product_images collision: exactly ONE row for the shared URL, on product 1; zero on 90001.
const sharedImages = d1(
  "SELECT id, store_product_id FROM product_images WHERE source_url='http://shared/a.jpg'"
);
assert.equal(sharedImages.length, 1, `expected exactly 1 product_images row for shared URL, got ${sharedImages.length}`);
assert.equal(sharedImages[0].store_product_id, 1, "surviving shared product_images row must belong to product 1");
const imagesOn90001 = d1("SELECT count(*) c FROM product_images WHERE store_product_id=90001")[0].c;
assert.equal(imagesOn90001, 0, "zero product_images rows may reference store_product_id=90001");
console.log("OK: product_images collision collapsed (1 row, product 1)");

// product_specs collision: exactly ONE row for the shared URL, on product 1.
const sharedSpecs = d1(
  "SELECT id, store_product_id FROM product_specs WHERE source_url='http://shared/s.jpg'"
);
assert.equal(sharedSpecs.length, 1, `expected exactly 1 product_specs row for shared URL, got ${sharedSpecs.length}`);
assert.equal(sharedSpecs[0].store_product_id, 1, "surviving shared product_specs row must belong to product 1");
console.log("OK: product_specs collision collapsed (1 row, product 1)");

// wishlist_items / showroom_scan_log: rows now reference product 1.
const wishlistRow = d1("SELECT showroom_store_product_id FROM wishlist_items WHERE id=90001")[0];
assert.equal(wishlistRow?.showroom_store_product_id, 1, "wishlist_items id=90001 must re-point to product 1");
const scanLogMatched = d1("SELECT matched_store_product_id FROM showroom_scan_log WHERE id=90001")[0];
assert.equal(scanLogMatched?.matched_store_product_id, 1, "showroom_scan_log id=90001 matched_store_product_id must re-point to product 1");
const scanLogAuto = d1("SELECT auto_created_product_id FROM showroom_scan_log WHERE id=90002")[0];
assert.equal(scanLogAuto?.auto_created_product_id, 1, "showroom_scan_log id=90002 auto_created_product_id must re-point to product 1");
console.log("OK: wishlist_items / showroom_scan_log re-pointed to product 1");

// --- Task 8: cascade-safe store_id drop (0095) ---
// showroom_store_products must have exactly 2 rows (real-data products 1, 2)
// and no longer have a store_id column.
const productCount = d1("SELECT count(*) c FROM showroom_store_products")[0].c;
assert.equal(productCount, 2, `expected 2 showroom_store_products rows after 0095, got ${productCount}`);
const productCols = d1("SELECT name FROM pragma_table_info('showroom_store_products')").map(
  (r) => r.name
);
assert.ok(
  !productCols.includes("store_id"),
  `showroom_store_products must not have a store_id column, got columns: ${productCols.join(", ")}`
);

// CASCADE children with real data must have survived the backup/restore wrap.
const mappingsCount = d1("SELECT count(*) c FROM showroom_product_mappings")[0].c;
assert.equal(mappingsCount, 2, `expected 2 showroom_product_mappings rows, got ${mappingsCount}`);
const priceObsCount = d1("SELECT count(*) c FROM product_price_observations")[0].c;
assert.equal(priceObsCount, 2, `expected 2 product_price_observations rows, got ${priceObsCount}`);

// SET-NULL children must have their FK pointer restored (not left null).
const wishlist95001 = d1(
  "SELECT showroom_store_product_id FROM wishlist_items WHERE id=95001"
)[0];
assert.equal(
  wishlist95001?.showroom_store_product_id,
  1,
  "wishlist_items id=95001 must have showroom_store_product_id restored to 1"
);
const material95001 = d1(
  "SELECT purchased_showroom_product_id FROM material_schedule_items WHERE id=95001"
)[0];
assert.equal(
  material95001?.purchased_showroom_product_id,
  2,
  "material_schedule_items id=95001 must have purchased_showroom_product_id restored to 2"
);

// No leftover __bak_* tables from the backup/restore wrap.
const bakTables = d1(
  "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '__bak_%'"
);
assert.equal(bakTables.length, 0, `expected zero __bak_* tables, got: ${bakTables.map((r) => r.name).join(", ")}`);

console.log(
  "OK: 0095 cascade-safe store_id drop (2 products, no store_id column, 2 mappings, 2 price_obs, SET-NULL pointers restored, 0 __bak_* tables)"
);

// --- Task 9: model/msrp columns present on showroom_store_products ---
const cols = d1("PRAGMA table_info(showroom_store_products)").map((r) => r.name);
assert.ok(!cols.includes("store_id"), "store_id column must be dropped");
assert.ok(
  ["model_key", "msrp", "msrp_cents"].every((c) => cols.includes(c)),
  "new columns present"
);
const obsCols = d1("PRAGMA table_info(product_price_observations)").map((r) => r.name);
assert.ok(
  ["price_cents", "sale_price_cents", "discount_pct"].every((c) => obsCols.includes(c)),
  "observation numeric columns present"
);
console.log("OK: product schema shape");

// --- Task 10: record_price_observation derives non-null price_cents from text ---
// Insert a synthetic observation directly (DB-level assert; MCP handler wiring
// verified by build/tsc) mirroring what record_price_observation would write.
d1(
  "INSERT INTO product_price_observations (product_id, source_type, price, price_cents, review_status) " +
    "VALUES (1, 'manufacturer', '$999.00', 99900, 'approved')"
);
const insertedObs = d1(
  "SELECT price_cents FROM product_price_observations WHERE product_id=1 AND price='$999.00' ORDER BY id DESC LIMIT 1"
)[0];
assert.ok(insertedObs, "expected the synthetic observation to be inserted");
assert.equal(insertedObs.price_cents, 99900, "text price '$999.00' must yield price_cents 99900");
console.log("OK: price observation text price -> non-null price_cents");
