/**
 * Runnable self-check for the Drive diff classifier. No framework:
 *   npx tsx src/backend/services/google/drive-diff.test.ts
 */
import assert from "node:assert/strict";

import type { DriveNode } from "./drive";

import { diffNodes, type ExistingRow } from "./drive-diff";

function node(over: Partial<DriveNode> & { driveId: string }): DriveNode {
  return {
    name: "file.pdf",
    mimeType: "application/pdf",
    parentDriveId: "FOLDER_1",
    sizeBytes: 100,
    md5Checksum: "abc",
    webViewUrl: "https://drive/x",
    sharing: "PRIVATE",
    modifiedAt: null,
    createdAt: null,
    isFolder: false,
    ...over,
  };
}
const hashOf = (n: DriveNode) => n.md5Checksum ?? "nohash";
const row = (o: Partial<ExistingRow> & { id: number; driveId: string }): ExistingRow => ({
  folderDriveId: "FOLDER_1",
  name: "file.pdf",
  contentHash: "abc",
  ...o,
});

// New file → create
assert.deepEqual(diffNodes([node({ driveId: "A" })], [], hashOf), [
  { kind: "create", node: node({ driveId: "A" }) },
]);

// Identical → unchanged
assert.deepEqual(diffNodes([node({ driveId: "A" })], [row({ id: 1, driveId: "A" })], hashOf), [
  { kind: "unchanged", existingId: 1 },
]);

// Renamed → supersede
{
  const live = node({ driveId: "A", name: "renamed.pdf" });
  assert.deepEqual(diffNodes([live], [row({ id: 1, driveId: "A" })], hashOf), [
    { kind: "supersede", existingId: 1, node: live },
  ]);
}

// Moved to another folder → supersede
{
  const live = node({ driveId: "A", parentDriveId: "FOLDER_2" });
  assert.deepEqual(diffNodes([live], [row({ id: 1, driveId: "A" })], hashOf), [
    { kind: "supersede", existingId: 1, node: live },
  ]);
}

// Content changed → supersede
{
  const live = node({ driveId: "A", md5Checksum: "zzz" });
  assert.deepEqual(diffNodes([live], [row({ id: 1, driveId: "A" })], hashOf), [
    { kind: "supersede", existingId: 1, node: live },
  ]);
}

// Gone from Drive → delete
assert.deepEqual(diffNodes([], [row({ id: 1, driveId: "A" })], hashOf), [
  { kind: "delete", existingId: 1 },
]);

// Two files with identical content are NOT deduped — they are distinct rows.
// (The 6 duplicate "Luxury Workstation Sink Market Analysis" Docs are real
// separate files; equal hashes must not collapse them.)
{
  const actions = diffNodes([node({ driveId: "A" }), node({ driveId: "B" })], [], hashOf);
  assert.equal(actions.length, 2);
  assert.equal(
    actions.every((a) => a.kind === "create"),
    true,
  );
}

console.log("drive-diff.test.ts: all assertions passed");
