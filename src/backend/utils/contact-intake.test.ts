/**
 * Runnable self-check for the contact-intake helpers. No framework:
 *   npx tsx src/backend/utils/contact-intake.test.ts
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";

import {
  inferContactType,
  looksLikePersonName,
  parseEmailIdentity,
  titleCaseName,
} from "./contact-intake";

// ── titleCaseName ───────────────────────────────────────────────────────────
assert.equal(titleCaseName("nancy ruiz"), "Nancy Ruiz");
assert.equal(titleCaseName("NANCY RUIZ"), "Nancy Ruiz");
assert.equal(titleCaseName("mary-jane o'neil"), "Mary-Jane O'Neil");
assert.equal(titleCaseName("  elliot   castro "), "Elliot Castro");
assert.equal(titleCaseName(""), null);
assert.equal(titleCaseName(null), null);

// ── parseEmailIdentity: the real From-header shapes we saw in prod ───────────
assert.deepEqual(parseEmailIdentity("nancy ruiz <nancy@pietrafina.com>"), {
  displayName: "nancy ruiz",
  email: "nancy@pietrafina.com",
});
assert.deepEqual(parseEmailIdentity('"IRG - Stone" <postmaster@irgstone.com>'), {
  displayName: "IRG - Stone",
  email: "postmaster@irgstone.com",
});
// display == address junk → no display name
assert.deepEqual(parseEmailIdentity('"adam@allnaturalstone.com" <adam@allnaturalstone.com>'), {
  displayName: null,
  email: "adam@allnaturalstone.com",
});
// bare address
assert.deepEqual(parseEmailIdentity("marcus@decorativeplumbingsupply.com"), {
  displayName: null,
  email: "marcus@decorativeplumbingsupply.com",
});
assert.deepEqual(parseEmailIdentity(""), { displayName: null, email: null });
assert.deepEqual(parseEmailIdentity("not an email"), { displayName: null, email: null });

// ── looksLikePersonName: people yes, brands/roles no ────────────────────────
assert.equal(looksLikePersonName("Nancy Ruiz"), true);
assert.equal(looksLikePersonName("elliot castro"), true);
assert.equal(looksLikePersonName("Anthony Zamora"), true);
assert.equal(looksLikePersonName("Kohler Customer Care"), false, "role keyword");
assert.equal(looksLikePersonName("Kohler Co."), false, "company suffix");
assert.equal(looksLikePersonName("Designer's Brass Inc."), false, "company suffix");
assert.equal(looksLikePersonName("Rejuvenation"), false, "single-word brand");
assert.equal(looksLikePersonName("IRG - Stone Slabs & Tiles"), false, "symbols/too long");

// ── inferContactType: title first, then email local-part fallback ───────────
assert.equal(inferContactType("Sales Consultant"), "SALES");
assert.equal(inferContactType("Estimator"), "ESTIMATOR");
assert.equal(inferContactType("Showroom Manager"), "MANAGER");
assert.equal(inferContactType(null, "sales@x.com"), "SALES");
assert.equal(inferContactType(null, "orders@designersbrass.com"), "CUSTOMER_SERVICE");
assert.equal(inferContactType(null, "kohler.customercare@kohler.com"), "CUSTOMER_SERVICE");
assert.equal(inferContactType(null, "nancy@pietrafina.com"), "OTHER", "a person's own address");
assert.equal(inferContactType(null, null), "OTHER");

console.log("contact-intake: all assertions passed ✓");
