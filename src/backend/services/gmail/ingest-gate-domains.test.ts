/**
 * Runnable self-check for the ingest-gate domain logic (0039). No framework:
 *   npx tsx src/backend/services/gmail/ingest-gate-domains.test.ts
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";

import {
  EXCLUDED_DOMAINS,
  EXCLUDED_EXACT_ADDRESSES,
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

// ── the Pietra Fina path end-to-end: sender address → gated vendor domain ───
const d = normalizeDomain("nancy@pietrafina.com");
assert.ok(d && isGatedDomain(d, PUBLIC), "Pietra Fina sender resolves to a gated domain");

console.log("ingest-gate-domains: all assertions passed ✓");
