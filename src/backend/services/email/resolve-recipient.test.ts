/**
 * Runnable self-check for the pure recipient helpers. No framework:
 *   npx tsx src/backend/services/email/resolve-recipient.test.ts
 */
import assert from "node:assert/strict";

import { isValidEmail } from "./resolve-recipient";

assert.equal(isValidEmail("nancy@pietrafina.com"), true);
assert.equal(isValidEmail("a.b-c+tag@sub.example.co.uk"), true);
assert.equal(isValidEmail("no-at-sign"), false);
assert.equal(isValidEmail("two@@at.com"), false);
assert.equal(isValidEmail("trailing@dot."), false);
assert.equal(isValidEmail(" leading-space@x.com"), false);
assert.equal(isValidEmail(""), false);

console.log("resolve-recipient.test.ts: all assertions passed");
