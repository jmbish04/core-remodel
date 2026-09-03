#!/usr/bin/env node
/**
 * @fileoverview Self-check for the shared compliance verdict math.
 *
 * This lives OUTSIDE the Worker bundle on purpose. `compliance-gates.ts` is
 * imported by two bundled routes, so an exported `__selfCheck` there ships to
 * production — and this Worker has already hit Cloudflare's 10 MiB script limit
 * once. `budget-grid-math.ts` sets the pattern: the logic is exported, the
 * assertions live here.
 *
 *   npx tsx scripts/tests/test_compliance_gate_math.mjs
 */
import assert from "node:assert/strict";
import {
  capForContractCents,
  downPaymentCapVerdict,
  licenseActiveVerdict,
  LICENSE_WARN_WINDOW_SECONDS,
} from "../../src/backend/services/budget/compliance-gates.ts";

const now = Date.now();

// California CSLB down-payment cap: the LESSER of $1,000 or 10% of the price.
assert.equal(capForContractCents(118_400_00), 100_000, "large contract caps at $1,000");
assert.equal(capForContractCents(9_500_00), 95_000, "small contract caps at 10%");
assert.equal(capForContractCents(10_000_00), 100_000, "boundary contract caps at $1,000");
assert.equal(capForContractCents(9_995_00), 99_950, "10% floors exactly, no float drift");

// The violation this feature exists to catch, and its passing twin.
assert.equal(
  downPaymentCapVerdict(118_400_00, 400_000),
  "fail",
  "$4,000 down on a $118,400 contract must fail",
);
assert.equal(
  downPaymentCapVerdict(31_600_00, 95_000),
  "pass",
  "$950 down on a $31,600 contract must pass",
);

// An unknown is never a pass on a compliance surface.
assert.equal(downPaymentCapVerdict(null, 100_000), "na", "no contract value on file -> na");
assert.equal(downPaymentCapVerdict(118_400_00, null), "na", "no recorded down payment -> na");
assert.equal(licenseActiveVerdict(null, now), "na", "no expiry on file -> na");

assert.equal(licenseActiveVerdict(new Date(now - 1000), now), "fail", "expired licence fails");
assert.equal(
  licenseActiveVerdict(new Date(now + 10 * 86_400_000), now),
  "warn",
  "licence expiring inside the warning window warns",
);
assert.equal(
  licenseActiveVerdict(new Date(now + (LICENSE_WARN_WINDOW_SECONDS + 86_400) * 1000), now),
  "pass",
  "licence well clear of the window passes",
);

console.log("test_compliance_gate_math.mjs: all assertions passed");
