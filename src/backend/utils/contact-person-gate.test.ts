/**
 * Runnable self-check for the deterministic contact-person gate. No framework:
 *   npx tsx src/backend/utils/contact-person-gate.test.ts
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";

import {
  evaluateContactWorthiness,
  extractSignatureName,
  hasBulkMarketingSignals,
  isAutomatedSender,
} from "./contact-person-gate";

// ── isAutomatedSender ───────────────────────────────────────────────────────
assert.equal(isAutomatedSender("no-reply@pietrafina.com"), true);
assert.equal(isAutomatedSender("noreply@x.com"), true);
assert.equal(isAutomatedSender("mailer-daemon@x.com"), true);
assert.equal(isAutomatedSender("marketing@x.com"), true);
assert.equal(isAutomatedSender("notifications@x.com"), true);
assert.equal(isAutomatedSender("bounce+abc@x.com"), true);
assert.equal(isAutomatedSender("nancy@pietrafina.com"), false);
assert.equal(isAutomatedSender("sales@pietrafina.com"), false, "role mailbox gated on signature, not hard-rejected");

// ── hasBulkMarketingSignals ─────────────────────────────────────────────────
assert.equal(hasBulkMarketingSignals("...\nUnsubscribe from these emails"), true);
assert.equal(hasBulkMarketingSignals("View this email in your browser"), true);
assert.equal(hasBulkMarketingSignals("Click here to view this email in browser"), true);
assert.equal(hasBulkMarketingSignals("Trouble viewing? View it online."), true);
assert.equal(hasBulkMarketingSignals("Manage your email preferences here"), true);
assert.equal(hasBulkMarketingSignals("Hi Justin, the slab is ready for pickup. — Nancy"), false);

// ── extractSignatureName ────────────────────────────────────────────────────
assert.equal(
  extractSignatureName("Hi Justin,\n\nHappy to help.\n\nBest regards,\nNancy Ruiz\nPietra Fina"),
  "Nancy Ruiz",
);
assert.equal(
  extractSignatureName("Quote attached.\n\nElliot Castro\n(510) 236-7960\nDJ Bath Plus"),
  "Elliot Castro",
);
assert.equal(extractSignatureName("No signature here, just body text about slabs."), null);

// ── evaluateContactWorthiness ───────────────────────────────────────────────
// automated sender → skip
assert.equal(evaluateContactWorthiness({ fromEmail: "no-reply@pietrafina.com" }).create, false);
// bulk header → skip
assert.equal(
  evaluateContactWorthiness({ fromEmail: "hello@x.com", fromDisplayName: "Jane Doe", listUnsubscribe: true }).create,
  false,
);
// bulk body → skip even with a name
assert.equal(
  evaluateContactWorthiness({
    fromEmail: "team@x.com",
    fromDisplayName: "Jane Doe",
    bodyText: "New arrivals!\nUnsubscribe",
  }).create,
  false,
);
// person via From display → create
{
  const v = evaluateContactWorthiness({ fromEmail: "nancy ruiz <nancy@pietrafina.com>" });
  assert.equal(v.create, true);
  assert.equal(v.personName, "Nancy Ruiz");
}
// person via body signature only (no display name) → create
{
  const v = evaluateContactWorthiness({
    fromEmail: "sales@djbathplus.com",
    bodyText: "Here's your quote.\n\nThanks,\nElliot Castro\nSales",
  });
  assert.equal(v.create, true);
  assert.equal(v.personName, "Elliot Castro");
}
// company/role only, no person → skip
assert.equal(
  evaluateContactWorthiness({ fromEmail: "orders@designersbrass.com", bodyText: "Your order shipped." }).create,
  false,
);
// our own address → skip
assert.equal(evaluateContactWorthiness({ fromEmail: "justin@126colby.com" }).create, false);

console.log("contact-person-gate: all assertions passed ✓");
