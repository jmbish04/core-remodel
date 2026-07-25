#!/usr/bin/env node
/**
 * Unit check for the email-loopback marker helpers (the parser-ish bits that
 * decide whether a delivered email body still carries what we planted).
 *
 * No framework, no network — bundles the real source with esbuild and asserts.
 *
 * Usage: node scripts/tests/test_email_loopback_markers.mjs
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSync } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../src/backend/services/health/email-loopback-markers.ts");

const { outputFiles } = buildSync({
  entryPoints: [src],
  bundle: true,
  write: false,
  format: "esm",
  platform: "neutral",
});
const mod = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

const {
  SUBJECT_PREFIX,
  isHealthcheckSubject,
  probeBody,
  extractionMatches,
  checkNumber,
  LABEL_UNIT_TESTING,
  LABEL_INBOX,
} = mod;

// Subject detection
assert.equal(isHealthcheckSubject(`${SUBJECT_PREFIX} hlb_abc`), true);
assert.equal(isHealthcheckSubject("Re: invoice #42"), false);
assert.equal(isHealthcheckSubject(null), false);

// A faithfully-delivered body extracts; a corrupted one does not.
const token = "hlb_deadbeef1234";
const n = 428917;
const body = probeBody(token, n, "outbound");
assert.equal(extractionMatches(body, token, n), true, "planted body must match");
assert.equal(extractionMatches(body, token, 111111), false, "wrong number must fail");
assert.equal(extractionMatches(body, "hlb_other", n), false, "wrong token must fail");
assert.equal(extractionMatches("", token, n), false, "empty body must fail");
// A partial number must not satisfy the \b-anchored match.
assert.equal(extractionMatches(body, token, 42891), false, "number prefix must not match");

// Labels are the predictable, programmatic names.
assert.equal(LABEL_UNIT_TESTING, "core-remodel/unit-testing");
assert.equal(LABEL_INBOX, "core-remodel/inbox");

// checkNumber is always a 6-digit int.
for (let i = 0; i < 100; i++) {
  const v = checkNumber();
  assert.ok(Number.isInteger(v) && v >= 100000 && v <= 999999, `checkNumber out of range: ${v}`);
}

console.log("ok — email-loopback marker checks passed");
