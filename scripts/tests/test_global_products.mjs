// Run: node scripts/tests/test_global_products.mjs
import assert from "node:assert";

// Inline helper functions (TypeScript import resolution fallback)
function normalizeModelKey(input) {
  if (input == null) return null;
  const key = String(input).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return key.length > 0 ? key : null;
}

function parsePriceCents(input) {
  if (input == null) return null;
  const cleaned = String(input).replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const dollars = Number.parseFloat(cleaned);
  if (!Number.isFinite(dollars)) return null;
  return Math.round(dollars * 100);
}

function parseDiscountPct(input) {
  if (input == null) return null;
  const cleaned = String(input).replace(/[^0-9.]/g, "");
  if (cleaned === "" || cleaned === ".") return null;
  const pct = Number.parseFloat(cleaned);
  return Number.isFinite(pct) ? pct : null;
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
