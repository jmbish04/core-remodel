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
const hashOf = (n: DriveNode) => ({ hash: n.md5Checksum ?? "nohash", source: "drive_md5" });
const row = (o: Partial<ExistingRow> & { id: number; driveId: string }): ExistingRow => ({
  folderDriveId: "FOLDER_1",
  name: "file.pdf",
  contentHash: "abc",
  hashSource: "drive_md5",
  isDeleted: false,
  revisionNumber: 1,
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
    { kind: "supersede", existingId: 1, node: live, revisionNumber: 2 },
  ]);
}

// Moved to another folder → supersede
{
  const live = node({ driveId: "A", parentDriveId: "FOLDER_2" });
  assert.deepEqual(diffNodes([live], [row({ id: 1, driveId: "A" })], hashOf), [
    { kind: "supersede", existingId: 1, node: live, revisionNumber: 2 },
  ]);
}

// Content changed → supersede
{
  const live = node({ driveId: "A", md5Checksum: "zzz" });
  assert.deepEqual(diffNodes([live], [row({ id: 1, driveId: "A" })], hashOf), [
    { kind: "supersede", existingId: 1, node: live, revisionNumber: 2 },
  ]);
}

// Gone from Drive → delete
assert.deepEqual(diffNodes([], [row({ id: 1, driveId: "A" })], hashOf), [
  { kind: "delete", existingId: 1 },
]);

// ── the returning-file case ────────────────────────────────────────────────
// A delete-marked row STAYS in `existing`. Seeing the file again clears the
// flag on the SAME row; treating it as new would leave two active rows for one
// Drive id (add a mime exclusion, scan, remove it, scan — 55 duplicates).
assert.deepEqual(
  diffNodes([node({ driveId: "A" })], [row({ id: 1, driveId: "A", isDeleted: true })], hashOf),
  [{ kind: "undelete", existingId: 1 }],
);

// A returning file that ALSO changed is a supersede, not an undelete — the new
// row is active and not deleted.
{
  const live = node({ driveId: "A", name: "renamed.pdf" });
  assert.deepEqual(
    diffNodes([live], [row({ id: 1, driveId: "A", isDeleted: true, revisionNumber: 4 })], hashOf),
    [{ kind: "supersede", existingId: 1, node: live, revisionNumber: 5 }],
  );
}

// Still gone AND already delete-marked → no action. Re-marking would report a
// non-zero `deleted` on every scan for ever.
assert.deepEqual(diffNodes([], [row({ id: 1, driveId: "A", isDeleted: true })], hashOf), []);

// A node that IS in Drive but could not be hashed this run (failed export) is
// skipped, not deleted. "We could not read it" is not "it is gone".
assert.deepEqual(diffNodes([], [row({ id: 1, driveId: "A" })], hashOf, ["A"]), []);

// ── hashSource ─────────────────────────────────────────────────────────────
// A hash is never compared across kinds. A failed Google Docs export used to
// fall back to a metadata hash, which flipped the source and superseded the
// doc; the next good scan superseded it back. Different source => not a
// content change.
assert.deepEqual(
  diffNodes(
    [node({ driveId: "A" })],
    [row({ id: 1, driveId: "A", contentHash: "other", hashSource: "metadata" })],
    hashOf,
  ),
  [{ kind: "unchanged", existingId: 1 }],
);
// Same source, different hash → a real content change.
{
  const live = node({ driveId: "A", md5Checksum: "zzz" });
  assert.deepEqual(diffNodes([live], [row({ id: 1, driveId: "A", revisionNumber: 2 })], hashOf), [
    { kind: "supersede", existingId: 1, node: live, revisionNumber: 3 },
  ]);
}

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
