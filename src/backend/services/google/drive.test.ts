/**
 * Runnable self-check for the Drive client's pure helpers. No framework:
 *   npx tsx src/backend/services/google/drive.test.ts
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";

import { deriveSharing, isExcluded } from "./drive";

// ── deriveSharing: the Apps Script Access enum is NOT returned by Drive v3.
// It has to be derived from permissions[] + allowFileDiscovery. ──────────────
assert.equal(deriveSharing(undefined), "PRIVATE");
assert.equal(deriveSharing([]), "PRIVATE");
assert.equal(deriveSharing([{ type: "user", role: "owner" }]), "PRIVATE");

assert.equal(
  deriveSharing([{ type: "anyone", role: "reader", allowFileDiscovery: true }]),
  "ANYONE",
);
assert.equal(
  deriveSharing([{ type: "anyone", role: "reader", allowFileDiscovery: false }]),
  "ANYONE_WITH_LINK",
);
// Drive omits allowFileDiscovery when it is false — absent must NOT read as true.
assert.equal(deriveSharing([{ type: "anyone", role: "reader" }]), "ANYONE_WITH_LINK");

assert.equal(
  deriveSharing([{ type: "domain", role: "reader", allowFileDiscovery: true }]),
  "DOMAIN",
);
assert.equal(
  deriveSharing([{ type: "domain", role: "reader", allowFileDiscovery: false }]),
  "DOMAIN_WITH_LINK",
);

// anyone outranks domain when both are present — it is strictly more open.
assert.equal(
  deriveSharing([
    { type: "domain", role: "reader", allowFileDiscovery: true },
    { type: "anyone", role: "reader", allowFileDiscovery: false },
  ]),
  "ANYONE_WITH_LINK",
);

// ── isExcluded ──────────────────────────────────────────────────────────────
const opts = {
  excludedFolderIds: new Set(["FOLDER_A"]),
  excludedMimePatterns: ["application/vnd.google-apps.script", "video/*"],
};
assert.equal(
  isExcluded({ driveId: "FOLDER_A", mimeType: "application/vnd.google-apps.folder" }, opts),
  true,
);
assert.equal(
  isExcluded({ driveId: "FOLDER_B", mimeType: "application/vnd.google-apps.folder" }, opts),
  false,
);
assert.equal(
  isExcluded({ driveId: "X", mimeType: "application/vnd.google-apps.script" }, opts),
  true,
);
assert.equal(isExcluded({ driveId: "X", mimeType: "video/mp4" }, opts), true);
assert.equal(isExcluded({ driveId: "X", mimeType: "image/jpeg" }, opts), false);

console.log("drive.test.ts: all assertions passed");
