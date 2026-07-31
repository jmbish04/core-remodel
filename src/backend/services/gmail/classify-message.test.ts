/**
 * Runnable self-check for deterministic message classification + quote trimming
 * (0041). No framework:
 *   npx tsx src/backend/services/gmail/classify-message.test.ts
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";

import { classifyMessage, trimQuotedReply } from "./classify-message";

// ── spam ────────────────────────────────────────────────────────────────────
{
  const r = classifyMessage({
    subject: "Big Summer Sale",
    body: "50% off everything!\n\nUnsubscribe here | Manage preferences",
    hasAttachments: false,
  });
  assert.equal(r.isSpam, true);
  assert.equal(r.spamRationale, "unsubscribe");
  // "50% off" is a deal → Sales (not buried as generic promotional/spam).
  assert.equal(r.classification, "sale");
}

// ── promotional (spam, no deal/purchase keyword) → promotional ──────────────
{
  const r = classifyMessage({
    subject: "Our latest newsletter",
    body: "Read our blog.\n\nUnsubscribe | Manage preferences",
    hasAttachments: false,
  });
  assert.equal(r.isSpam, true);
  assert.equal(r.classification, "promotional");
}

// ── contract → Contracts folder ─────────────────────────────────────────────
{
  const r = classifyMessage({
    subject: "Please sign: Master Service Agreement",
    body: "Attached is the contract for your signature via DocuSign.",
    hasAttachments: true,
  });
  assert.equal(r.classification, "contract");
}

// ── "contractor"/"terms and conditions" must NOT trip Contracts ─────────────
{
  const sub = classifyMessage({
    subject: "Your subcontractor is on the way",
    body: "The subcontractor will arrive at 9am.",
    hasAttachments: false,
  });
  assert.equal(sub.classification, "normal", "'subcontractor' is not a contract");

  // A receipt whose footer says "terms and conditions" stays a receipt, not contract.
  const rc = classifyMessage({
    subject: "Receipt",
    body: "Paid $50. See our terms and conditions.",
    hasAttachments: false,
  });
  assert.equal(rc.classification, "receipt");
}

// ── sale keyword → Sales ────────────────────────────────────────────────────
{
  const r = classifyMessage({
    subject: "Clearance event this weekend",
    body: "Final sale on all floor models.",
    hasAttachments: false,
  });
  assert.equal(r.classification, "sale");
}

// ── quote separate from receipt ─────────────────────────────────────────────
{
  const q = classifyMessage({ subject: "Your quote", body: "Total $2,400", hasAttachments: false });
  assert.equal(q.classification, "quote");
  const rc = classifyMessage({ subject: "Receipt for your order", body: "Paid $2,400", hasAttachments: false });
  assert.equal(rc.classification, "receipt");
}

// ── normal ────────────────────────────────────────────────────────────────
{
  const r = classifyMessage({
    subject: "Re: slab availability",
    body: "Yes we have the Calacatta in stock, come by tomorrow.",
    hasAttachments: false,
  });
  assert.equal(r.isSpam, false);
  assert.equal(r.spamRationale, null);
  assert.equal(r.classification, "normal");
}

// ── receipt needs keyword AND ($ OR attachment) ─────────────────────────────
{
  // keyword but no $ and no attachment → NOT a receipt
  const noMoney = classifyMessage({ subject: "your invoice", body: "see attached", hasAttachments: false });
  assert.equal(noMoney.classification, "normal");

  // keyword + $ → invoice
  const withMoney = classifyMessage({
    subject: "Your invoice #1234",
    body: "Total due: $1,299.00",
    hasAttachments: false,
  });
  assert.equal(withMoney.classification, "invoice");

  // keyword + attachment (no $) → receipt
  const withAttach = classifyMessage({
    subject: "Order confirmation",
    body: "Thanks for your purchase.",
    hasAttachments: true,
  });
  assert.equal(withAttach.classification, "receipt");
}

// ── spam + receipt co-occur: receipt classification wins, still flagged spam ─
{
  const r = classifyMessage({
    subject: "SALE + your quote",
    body: "Here is your quote for $500.\nUnsubscribe to stop these emails.",
    hasAttachments: false,
  });
  assert.equal(r.classification, "quote");
  assert.equal(r.isSpam, true);
  assert.equal(r.spamRationale, "unsubscribe");
}

// ── sender-based spam: exact flagged address ────────────────────────────────
{
  const r = classifyMessage({
    from: "Rejuvenation <Rejuvenation@e.rejuvenation.com>",
    subject: "New arrivals",
    body: "Check out our latest lighting.",
    hasAttachments: false,
  });
  assert.equal(r.isSpam, true);
  assert.equal(r.spamRationale, "sender: rejuvenation@e.rejuvenation.com");
  assert.equal(r.classification, "promotional");
}

// ── sender-based spam: bulk marketing subdomain (e.brand.com) ────────────────
{
  const r = classifyMessage({
    from: "deals@email.potterybarn.com",
    subject: "Weekend sale",
    body: "Shop now.",
    hasAttachments: false,
  });
  assert.equal(r.isSpam, true);
  assert.equal(r.spamRationale, "bulk sender: email.potterybarn.com");
}

// ── a real person at the ROOT domain is NOT spam ────────────────────────────
{
  const r = classifyMessage({
    from: "nancy@pietrafina.com",
    subject: "Re: your slab",
    body: "It's ready for pickup.",
    hasAttachments: false,
  });
  assert.equal(r.isSpam, false);
  assert.equal(r.classification, "normal");
}

// ── sender spam + receipt: receipt classification still wins, still spam ─────
{
  const r = classifyMessage({
    from: "rejuvenation@e.rejuvenation.com",
    subject: "Your invoice",
    body: "Total: $200",
    hasAttachments: false,
  });
  assert.equal(r.isSpam, true);
  assert.equal(r.spamRationale, "sender: rejuvenation@e.rejuvenation.com");
  assert.equal(r.classification, "invoice");
}

// ── quote trimming: "On … wrote:" ───────────────────────────────────────────
{
  const body = "Sounds good, see you then.\n\nOn Mon, Jan 5, 2026 at 9:00 AM, Jane <j@x.com> wrote:\n> earlier message\n> more";
  const { visible, quoted } = trimQuotedReply(body);
  assert.equal(visible, "Sounds good, see you then.");
  assert.ok(quoted.startsWith("On Mon"));
}

// ── quote trimming: -----Original Message----- ──────────────────────────────
{
  const body = "My reply here.\n\n-----Original Message-----\nFrom: someone";
  const { visible } = trimQuotedReply(body);
  assert.equal(visible, "My reply here.");
}

// ── quote trimming: trailing > block ────────────────────────────────────────
{
  const body = "new text\n\n> quoted line 1\n> quoted line 2";
  const { visible, quoted } = trimQuotedReply(body);
  assert.equal(visible, "new text");
  assert.ok(quoted.startsWith(">"));
}

// ── no quote → all visible ──────────────────────────────────────────────────
{
  const { visible, quoted } = trimQuotedReply("just a plain message");
  assert.equal(visible, "just a plain message");
  assert.equal(quoted, "");
}

console.log("classify-message: all assertions passed");
