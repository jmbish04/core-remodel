/**
 * Runnable self-check for the ingest-gate domain logic (0039). No framework:
 *   npx tsx src/backend/services/gmail/ingest-gate-domains.test.ts
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";

import {
  EXCLUDED_DOMAINS,
  EXCLUDED_EXACT_ADDRESSES,
  isExcludedSender,
  isGatedDomain,
  normalizeDomain,
} from "./ingest-gate-domains";

const PUBLIC = new Set(["gmail.com", "yahoo.com", "hotmail.com"]);

// ── normalizeDomain: URLs, hosts, emails, junk ──────────────────────────────
assert.equal(normalizeDomain("http://www.pietrafina.com/"), "pietrafina.com");
assert.equal(normalizeDomain("https://pietrafina.com"), "pietrafina.com");
assert.equal(normalizeDomain("www.PietraFina.com"), "pietrafina.com");
assert.equal(normalizeDomain("pietrafina.com/slabs?x=1#frag"), "pietrafina.com");
assert.equal(normalizeDomain("nancy@pietrafina.com"), "pietrafina.com");
assert.equal(normalizeDomain("mailto:nancy@pietrafina.com"), "pietrafina.com");
assert.equal(normalizeDomain("  HTTPS://Sub.Example.CO.uk/path "), "sub.example.co.uk");
assert.equal(normalizeDomain(""), null);
assert.equal(normalizeDomain(null), null);
assert.equal(normalizeDomain("localhost"), null); // no dot
assert.equal(normalizeDomain("notaurl"), null);

// ── isGatedDomain: our domains + public providers are NOT gated ─────────────
assert.equal(isGatedDomain("pietrafina.com", PUBLIC), true, "vendor domain is gated");
assert.equal(isGatedDomain("126colby.com", PUBLIC), false, "our domain excluded");
assert.equal(isGatedDomain("hacolby.app", PUBLIC), false, "worker domain excluded");
assert.equal(isGatedDomain("gmail.com", PUBLIC), false, "public provider excluded");

// ── exclusion constants match the spec ──────────────────────────────────────
assert.ok(EXCLUDED_DOMAINS.has("126colby.com"));
assert.ok(EXCLUDED_DOMAINS.has("hacolby.app"));
assert.ok(EXCLUDED_EXACT_ADDRESSES.has("jmbish04@gmail.com"));
assert.ok(EXCLUDED_EXACT_ADDRESSES.has("jasonowyong87@gmail.com"));

// ── isExcludedSender: never auto-register ourselves as a vendor contact ─────
assert.equal(isExcludedSender("justin@126colby.com"), true, "our domain excluded");
assert.equal(isExcludedSender("justin bishop <justin@126colby.com>"), true, "raw From header form");
assert.equal(isExcludedSender("JUSTIN@126Colby.com"), true, "case-insensitive");
assert.equal(isExcludedSender("anyone@sub.126colby.com"), true, "subdomain excluded");
assert.equal(isExcludedSender("x@hacolby.app"), true, "worker domain excluded");
assert.equal(isExcludedSender("jmbish04@gmail.com"), true, "personal gmail excluded");
assert.equal(isExcludedSender("jasonowyong87@gmail.com"), true, "personal gmail excluded");
assert.equal(isExcludedSender("nancy@pietrafina.com"), false, "real vendor allowed");
assert.equal(isExcludedSender("someoneelse@gmail.com"), false, "other gmail allowed");
assert.equal(isExcludedSender(null), false);
assert.equal(isExcludedSender(""), false);

// ── the Pietra Fina path end-to-end: sender address → gated vendor domain ───
const d = normalizeDomain("nancy@pietrafina.com");
assert.ok(d && isGatedDomain(d, PUBLIC), "Pietra Fina sender resolves to a gated domain");

console.log("ingest-gate-domains: all assertions passed ✓");
