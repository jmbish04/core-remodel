#!/usr/bin/env node
/**
 * Pins the intake data-quality guard.
 *
 * The guard exists because nothing at intake caught any of this (audit of 146
 * prod stores, 2026-07-16): 86 with zero categories, 78 with no logo, 4 carrying
 * a region ("Bay Area, CA") in the street-address field. `locationAddress` was
 * `z.string().optional().nullable()` and `categoryIds` defaulted to `[]`, so
 * every one of those payloads parsed clean.
 *
 * Usage: node scripts/tests/test_showroom_quality.mjs  |  pnpm run test:quality
 */
import assert from "node:assert/strict";

import {
  assessIntakeQuality,
  hasBlockingIssue,
  isProperStreetAddress,
  stripAddressAnnotation,
} from "../../src/backend/utils/showroom-quality.ts";

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

const codes = (input) => assessIntakeQuality(input).map((w) => w.code).sort();

const GOOD = {
  name: "Rubenstein Supply",
  locationAddress: "1035 Ashby Ave, Berkeley, CA 94710",
  categoryIds: [3],
  links: [{ url: "https://rubensteinsupply.com", type: "WEBSITE" }],
};

console.log("\naddress shape");

check("a real street address passes", () => {
  assert.equal(isProperStreetAddress("1035 Ashby Ave, Berkeley, CA 94710"), true);
  assert.equal(isProperStreetAddress("1998 Republic Ave, San Leandro, CA 94577, USA"), true);
});

check("THE PROD BUG: a region is not an address", () => {
  // The literal values sitting in prod on stores #25/#30/#33/#34.
  for (const a of ["Bay Area, CA", "San Jose, CA", "Emeryville, CA"]) {
    assert.equal(isProperStreetAddress(a), false, `accepted ${a}`);
  }
});

check("placeholder junk is rejected", () => {
  for (const a of ["TBD", "N/A", "unknown", "various", "multiple locations", ""]) {
    assert.equal(isProperStreetAddress(a), false, `accepted ${a}`);
  }
});

check("missing zip or street number is rejected", () => {
  assert.equal(isProperStreetAddress("Ashby Ave, Berkeley, CA 94710"), false);
  assert.equal(isProperStreetAddress("1035 Ashby Ave, Berkeley, CA"), false);
});

check("strips a leading annotation (prod store #27)", () => {
  assert.equal(
    stripAddressAnnotation("*BY APPOINTMENT ONLY*, 1998 Republic Ave, San Leandro, CA 94577, USA"),
    "1998 Republic Ave, San Leandro, CA 94577, USA",
  );
  // Leaves a clean address untouched.
  assert.equal(
    stripAddressAnnotation("1035 Ashby Ave, Berkeley, CA 94710"),
    "1035 Ashby Ave, Berkeley, CA 94710",
  );
});

console.log("\nintake assessment");

check("a complete payload produces no warnings", () => {
  assert.deepEqual(codes(GOOD), []);
});

check("region-only address is flagged", () => {
  assert.ok(codes({ ...GOOD, locationAddress: "Bay Area, CA" }).includes("address_region_only"));
});

check("missing categories is flagged — the 86-store gap", () => {
  assert.ok(codes({ ...GOOD, categoryIds: [] }).includes("categories_missing"));
  assert.ok(codes({ ...GOOD, categoryIds: null }).includes("categories_missing"));
});

check("missing website is flagged", () => {
  assert.ok(codes({ ...GOOD, links: [] }).includes("website_missing"));
  // websiteUrl alone also satisfies it (the MCP path sends it that way).
  assert.ok(!codes({ ...GOOD, links: [], websiteUrl: "https://x.com" }).includes("website_missing"));
});

check("a social-only link set still counts as no website", () => {
  const c = codes({ ...GOOD, links: [{ url: "https://instagram.com/x", type: "INSTAGRAM" }] });
  assert.ok(c.includes("website_missing"));
});

check("empty address is flagged as missing, not as region-only", () => {
  const c = codes({ ...GOOD, locationAddress: "" });
  assert.ok(c.includes("address_missing"));
  assert.ok(!c.includes("address_region_only"));
});

check("the worst-case payload reports every gap at once", () => {
  assert.deepEqual(
    codes({ name: "X", locationAddress: "Bay Area, CA", categoryIds: [], links: [] }),
    ["address_region_only", "categories_missing", "website_missing"],
  );
});

console.log("\nblocking vs advisory — intake must not hard-fail on thin data");

check("thin data warns but never blocks", () => {
  // Adding a showroom from a phone mid-visit must still succeed.
  const w = assessIntakeQuality({ name: "X", locationAddress: "Bay Area, CA", categoryIds: [], links: [] });
  assert.ok(w.length > 0);
  assert.equal(hasBlockingIssue(w), false);
});

check("a missing name DOES block — always a bug, never a judgement call", () => {
  const w = assessIntakeQuality({ name: "", locationAddress: GOOD.locationAddress, categoryIds: [1] });
  assert.equal(hasBlockingIssue(w), true);
  assert.ok(w.some((x) => x.code === "name_missing" && x.severity === "error"));
});

console.log(`\n${process.exitCode ? "FAILED" : "PASSED"} — ${passed} checks\n`);
