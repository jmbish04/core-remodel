/**
 * Runnable self-check for embedded-image detection (0041). No framework:
 *   npx tsx src/backend/services/gmail/inline-images.test.ts
 *
 * Covers collectInlineImageParts (which MIME parts count as embedded cid:
 * images) + base64UrlToBytes. The upload itself is ImageProcessorService
 * (separately trusted); this locks the part-selection logic.
 */
import assert from "node:assert/strict";

import { collectInlineImageParts, base64UrlToBytes } from "./client";

// A multipart/related payload: one text part, one INLINE image (Content-ID),
// one regular attachment image (filename, no Content-ID → NOT inline), nested.
const payload = {
  mimeType: "multipart/related",
  parts: [
    { mimeType: "text/html", body: { data: "PGh0bWw-" } },
    {
      mimeType: "image/png",
      headers: [
        { name: "Content-ID", value: "<logo123@mail.gmail.com>" },
        { name: "Content-Disposition", value: "inline" },
      ],
      body: { attachmentId: "ATT-1", size: 1234 },
    },
    {
      mimeType: "multipart/mixed",
      parts: [
        {
          mimeType: "image/jpeg",
          headers: [{ name: "Content-ID", value: "banner456@x" }], // no angle brackets
          body: { data: "aW1n" }, // inline bytes, no attachmentId
        },
        {
          // a downloadable attachment image — filename, NO Content-ID → skipped
          mimeType: "image/gif",
          filename: "photo.gif",
          body: { attachmentId: "ATT-2" },
        },
      ],
    },
  ],
};

const inline = collectInlineImageParts(payload);
assert.equal(inline.length, 2, "only the two Content-ID image parts are inline");

const logo = inline.find((i) => i.contentId === "logo123@mail.gmail.com");
assert.ok(logo, "angle brackets stripped from Content-ID");
assert.equal(logo.attachmentId, "ATT-1");
assert.equal(logo.inlineData, undefined, "has attachmentId → fetched separately, not inline bytes");
assert.equal(logo.mimeType, "image/png");

const banner = inline.find((i) => i.contentId === "banner456@x");
assert.ok(banner, "bare Content-ID (no brackets) still detected");
assert.equal(banner.inlineData, "aW1n", "inline bytes carried when no attachmentId");
assert.equal(banner.attachmentId, undefined);

// the filename-attachment image is NOT treated as an embedded image
assert.ok(!inline.some((i) => i.mimeType === "image/gif"), "plain attachment image excluded");

// empty / no-image payloads
assert.deepEqual(collectInlineImageParts(undefined), []);
assert.deepEqual(collectInlineImageParts({ mimeType: "text/plain", body: { data: "x" } }), []);

// base64UrlToBytes round-trips
const bytes = base64UrlToBytes("aGk"); // "hi"
assert.equal(bytes.length, 2);
assert.equal(bytes[0], 104);
assert.equal(bytes[1], 105);
assert.equal(base64UrlToBytes("").length, 0);

console.log("inline-images: all assertions passed");
