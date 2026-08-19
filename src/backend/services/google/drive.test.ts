/**
 * Runnable self-check for the Drive client's pure helpers. No framework:
 *   npx tsx src/backend/services/google/drive.test.ts
 * Exits non-zero on the first failed assertion.
 */
import assert from "node:assert/strict";

import type { DriveNode } from "./drive";

import { dedupeByDriveId, deriveSharing, isExcluded } from "./drive";

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

// ── dedupeByDriveId ─────────────────────────────────────────────────────────
// A Drive item can have SEVERAL parents. `listChildren` runs once per parent,
// so the walk yields one node per parent edge and the diff — which keys by
// Drive id — would emit `create` twice and write two active rows. QC cannot
// catch this: neither configured root is a Shared Drive.
function n(driveId: string, over: Partial<DriveNode> = {}): DriveNode {
  return {
    driveId,
    name: `${driveId}.pdf`,
    mimeType: "application/pdf",
    parentDriveId: "FOLDER_1",
    sizeBytes: 1,
    md5Checksum: "abc",
    webViewUrl: "https://drive/x",
    sharing: "PRIVATE",
    modifiedAt: null,
    createdAt: null,
    isFolder: false,
    ...over,
  };
}

// Two parents -> one node, FIRST parent wins.
{
  const deduped = dedupeByDriveId([
    n("A", { parentDriveId: "FOLDER_1" }),
    n("A", { parentDriveId: "FOLDER_2" }),
    n("B"),
  ]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0]?.driveId, "A");
  assert.equal(deduped[0]?.parentDriveId, "FOLDER_1");
  assert.equal(deduped[1]?.driveId, "B");
}

// Folders too — a duplicate folder made the drive-id -> row-id map
// nondeterministic, so documents attached to an arbitrary twin.
{
  const deduped = dedupeByDriveId([
    n("F", { isFolder: true, mimeType: "application/vnd.google-apps.folder" }),
    n("F", { isFolder: true, parentDriveId: "OTHER" }),
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0]?.parentDriveId, "FOLDER_1");
}

// Distinct ids are never merged, and order is preserved.
assert.deepEqual(
  dedupeByDriveId([n("A"), n("B"), n("C")]).map((x) => x.driveId),
  ["A", "B", "C"],
);
assert.deepEqual(dedupeByDriveId([]), []);

console.log("drive.test.ts: all assertions passed");
