/**
 * Runnable self-check for the attach-vs-link size logic. No framework:
 *   npx tsx src/backend/services/email/disposition.test.ts
 */
import assert from "node:assert/strict";

import { GMAIL_ATTACH_BUDGET_BYTES, suggestDispositions } from "./disposition";

const MB = 1024 * 1024;

// Small files all attach.
assert.deepEqual(
  suggestDispositions([
    { driveDocumentId: 1, sizeBytes: 2 * MB },
    { driveDocumentId: 2, sizeBytes: 3 * MB },
  ]),
  [
    { driveDocumentId: 1, suggestedDisposition: "attach" },
    { driveDocumentId: 2, suggestedDisposition: "attach" },
  ],
);

// The file that would cross the ~18 MiB budget flips to link; a later small one
// still fits and attaches.
{
  const out = suggestDispositions([
    { driveDocumentId: 1, sizeBytes: 15 * MB },
    { driveDocumentId: 2, sizeBytes: 10 * MB }, // 15+10 > 18 → link
    { driveDocumentId: 3, sizeBytes: 1 * MB }, // 15+1 ≤ 18 → attach
  ]);
  assert.deepEqual(out, [
    { driveDocumentId: 1, suggestedDisposition: "attach" },
    { driveDocumentId: 2, suggestedDisposition: "link" },
    { driveDocumentId: 3, suggestedDisposition: "attach" },
  ]);
}

// A file with unknown size (null) is linked — we cannot promise it fits.
assert.deepEqual(suggestDispositions([{ driveDocumentId: 9, sizeBytes: null }]), [
  { driveDocumentId: 9, suggestedDisposition: "link" },
]);

// A single file larger than the budget links.
assert.deepEqual(suggestDispositions([{ driveDocumentId: 5, sizeBytes: 50 * MB }]), [
  { driveDocumentId: 5, suggestedDisposition: "link" },
]);

assert.equal(GMAIL_ATTACH_BUDGET_BYTES, 18 * MB);
console.log("disposition.test.ts: all assertions passed");
