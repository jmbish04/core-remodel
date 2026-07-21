/**
 * scripts/tests/test_brand_image_grouping.ts
 *
 * Checks `deriveGroup()` — the one piece of real logic in the brand-image
 * harvest. Everything else in that module is fetch + threshold comparison;
 * this regex is what decides whether a brand gallery renders as coherent
 * product sets or as a shuffled wall of near-identical frames.
 *
 * Fixtures are REAL gessi.com filenames, which is the whole point: the pattern
 * was derived from that site's output, so synthetic names would only prove the
 * regex matches itself.
 *
 *   npx tsx scripts/tests/test_brand_image_grouping.ts
 */
import assert from "node:assert";

import { deriveGroup } from "../../src/backend/services/brands/brand-image-harvest";

const B = "https://www.gessi.com/media/";

// The hero and all eleven gallery frames of ONE product must collapse to one key.
const hero = deriveGroup(`${B}Collezione_Origini_warm_Gessi_HERO_9f2c.jpg`);
assert.strictEqual(hero.key, "collezione_origini_warm_gessi");
assert.strictEqual(hero.sortOrder, 0, "HERO must sort first");

for (let n = 1; n <= 11; n++) {
  const g = deriveGroup(`${B}Collezione_Origini_warm_Gessi_gallery_${n}_9f2c.jpg`);
  assert.strictEqual(g.key, hero.key, `gallery_${n} must share the hero's group`);
  assert.strictEqual(g.sortOrder, n, `gallery_${n} must sort at ${n}`);
}

// A DIFFERENT product must NOT collapse into the same group — the failure that
// matters most, since over-grouping silently merges unrelated products.
assert.notStrictEqual(
  deriveGroup(`${B}Collezione_Anello_black_Gessi_HERO_1a2b.jpg`).key,
  hero.key,
);

// Unmarked images still group by stem and sort after every marked frame.
const plain = deriveGroup(`${B}Rettangolo_K_Gessi.jpg`);
assert.strictEqual(plain.key, "rettangolo_k_gessi");
assert.strictEqual(plain.sortOrder, 999);

// Dimension suffixes are per-variant noise, not a distinct product.
assert.strictEqual(
  deriveGroup(`${B}Rettangolo_K_Gessi_800x600.jpg`).key,
  plain.key,
);

// Query strings must not leak into the key — image CDNs append them freely.
assert.strictEqual(deriveGroup(`${B}Rettangolo_K_Gessi.jpg?v=3`).key, plain.key);

// Degenerate input returns null rather than throwing mid-harvest.
assert.strictEqual(deriveGroup("not a url").key, null);
assert.strictEqual(deriveGroup(`${B}`).key, null);

console.log("✅ deriveGroup: 18 assertions passed");
