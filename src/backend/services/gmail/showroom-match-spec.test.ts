/**
 * Runnable self-check for the showroom inbox match-spec (0040 P4 bugfix). No
 * framework:
 *   npx tsx src/backend/services/gmail/showroom-match-spec.test.ts
 * Exits non-zero on the first failed assertion.
 *
 * The bug: a showroom's inbox domain-matched every POC/contact email, so a
 * distributor rep's employer domain fanned the inbox out to every unrelated
 * company that rep also emailed. The fix: only the showroom's OWN domain
 * (store email + WEBSITE links) matches domain-wide; contacts match by EXACT
 * address.
 */
import assert from "node:assert/strict";

import { buildShowroomMatchSpec } from "./participants";

const sorted = (a: string[]) => [...a].sort();

// ── Pietra Fina: own domain domain-wide, reps exact ─────────────────────────
{
  const spec = buildShowroomMatchSpec({
    ownEmails: ["sales@pietrafina.com"],
    websiteUrls: ["https://www.pietrafina.com/slabs"],
    // A Daltile rep and a gmail contact — must NOT pull in @daltile.com at large.
    contactEmails: ["nancy@daltile.com", "someguy@gmail.com"],
  });
  assert.deepEqual(sorted(spec.privateDomains), ["pietrafina.com"]);
  assert.deepEqual(sorted(spec.publicEmails), ["nancy@daltile.com", "someguy@gmail.com"]);
  // The bug would have put daltile.com in privateDomains.
  assert.ok(!spec.privateDomains.includes("daltile.com"), "rep domain must not be domain-matched");
}

// ── website link alone establishes the own-domain (empty store email) ───────
{
  const spec = buildShowroomMatchSpec({
    ownEmails: [],
    websiteUrls: ["pietrafina.com"],
    contactEmails: [],
  });
  assert.deepEqual(spec.privateDomains, ["pietrafina.com"]);
  assert.deepEqual(spec.publicEmails, []);
}

// ── an own-email on a public provider falls back to exact ───────────────────
{
  const spec = buildShowroomMatchSpec({
    ownEmails: ["pietrafinasf@gmail.com"],
    websiteUrls: [],
    contactEmails: [],
  });
  assert.deepEqual(spec.privateDomains, []);
  assert.deepEqual(spec.publicEmails, ["pietrafinasf@gmail.com"]);
}

// ── dedupe + display-name / junk handling ───────────────────────────────────
{
  const spec = buildShowroomMatchSpec({
    ownEmails: ["Sales <sales@pietrafina.com>"],
    websiteUrls: ["https://pietrafina.com/", "www.pietrafina.com"], // same domain twice
    contactEmails: ["nancy@daltile.com", "nancy@daltile.com", "not-an-email"],
  });
  assert.deepEqual(spec.privateDomains, ["pietrafina.com"]);
  assert.deepEqual(spec.publicEmails, ["nancy@daltile.com"]);
}

console.log("showroom-match-spec: all assertions passed");
