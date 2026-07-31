/**
 * Runnable self-check for attachment extraction classification (0042).
 *   npx tsx src/backend/services/email/attachment-kind.test.ts
 * Locks which attachments get non-AI text extraction vs a vision-OCR (approval)
 * gate vs nothing.
 */
import assert from "node:assert/strict";

import { attachmentExtractionKind } from "./pipeline";

// documents → deterministic toMarkdown text
assert.equal(attachmentExtractionKind("application/pdf", "quote.pdf"), "document");
assert.equal(attachmentExtractionKind("", "invoice.PDF"), "document");
assert.equal(attachmentExtractionKind("application/msword", "contract.doc"), "document");
assert.equal(
  attachmentExtractionKind("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "x.docx"),
  "document",
);
assert.equal(attachmentExtractionKind("", "sheet.xlsx"), "document");

// images → need AI vision OCR (gated by approval)
assert.equal(attachmentExtractionKind("image/jpeg", "receipt.jpg"), "image");
assert.equal(attachmentExtractionKind("image/png", "photo.png"), "image");

// everything else → nothing
assert.equal(attachmentExtractionKind("text/calendar", "invite.ics"), "none");
assert.equal(attachmentExtractionKind(null, null), "none");
assert.equal(attachmentExtractionKind("application/zip", "bundle.zip"), "none");

console.log("attachment-kind: all assertions passed");
