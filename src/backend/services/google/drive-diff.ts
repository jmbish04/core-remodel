/**
 * @fileoverview Pure classifier: what changed between Drive and D1.
 *
 * Kept free of network and database access so the interesting cases — rename,
 * move, content change, delete — are unit-testable. The writer applies these
 * actions; it does not decide them.
 *
 * Identity is the Drive file id. Equal content hashes do NOT merge two files:
 * the research corpus genuinely contains six separate Docs with the same title
 * and near-identical content, and collapsing them would lose real rows.
 */
import type { DriveNode } from "./drive";

export interface ExistingRow {
  id: number;
  driveId: string;
  /** Drive id of the row's current parent folder; null for a root. */
  folderDriveId: string | null;
  name: string;
  contentHash: string;
  /** Which kind of hash `contentHash` is — hashes are never compared across kinds. */
  hashSource: string;
  /** Delete-marked rows STAY in `existing` so a returning file un-deletes. */
  isDeleted: boolean;
  revisionNumber: number;
  /**
   * Current sharing level (ANYONE / ANYONE_WITH_LINK / DOMAIN / DOMAIN_WITH_LINK
   * / PRIVATE). Compared so a Drive permission change with no rename/move/edit
   * is not silently dropped — this value gates whether a link can be emailed to
   * an outside vendor, so a stale copy is a real hazard, not cosmetic.
   */
  sharing: string;
}

export type DiffAction =
  | { kind: "create"; node: DriveNode }
  | { kind: "supersede"; existingId: number; node: DriveNode; revisionNumber: number }
  | { kind: "undelete"; existingId: number }
  // Permissions changed but content/name/parent did not: update the SAME row in
  // place. Superseding would be wrong — the file did not change, so it would
  // mint a bogus revision and (in the research pipeline) force a re-embed.
  | { kind: "metadata-update"; existingId: number; node: DriveNode }
  | { kind: "delete"; existingId: number }
  | { kind: "unchanged"; existingId: number };

/**
 * @param live      every node currently in Drive under the root (post-exclusion)
 * @param existing  every ACTIVE row currently in D1 for that root, INCLUDING
 *                  delete-marked ones. Excluding those hides a delete-marked
 *                  row from the next diff, so a file that comes back (an
 *                  exclusion added then removed, a trash-then-restore, a move
 *                  out of and back into the tree) reads as brand new and mints
 *                  a SECOND active row for the same Drive id.
 * @param hashOf    content hash + its source for a node — md5 for binaries,
 *                  exported-text sha-256 for Google-native files (Drive gives
 *                  them no md5)
 * @param unreadable Drive ids that ARE in Drive but could not be hashed this
 *                  run (a failed export). They are absent from `live`, so
 *                  without this they would read as deleted — "we could not
 *                  read it" must never be recorded as "it is gone".
 */
export function diffNodes(
  live: DriveNode[],
  existing: ExistingRow[],
  hashOf: (node: DriveNode) => { hash: string; source: string },
  unreadable: Iterable<string> = [],
): DiffAction[] {
  const byDriveId = new Map(existing.map((row) => [row.driveId, row]));
  const actions: DiffAction[] = [];
  const seen = new Set<string>(unreadable);

  for (const node of live) {
    seen.add(node.driveId);
    const row = byDriveId.get(node.driveId);
    if (!row) {
      actions.push({ kind: "create", node });
      continue;
    }
    const { hash, source } = hashOf(node);
    // A hash is only comparable against a hash of the SAME kind. An export
    // blip that swings 'exported_text' -> 'metadata' and back would otherwise
    // supersede the doc twice for no real change.
    const contentChanged = row.hashSource === source && row.contentHash !== hash;
    const changed =
      row.name !== node.name || row.folderDriveId !== node.parentDriveId || contentChanged;
    if (changed) {
      // A supersede's replacement row carries the node's current sharing, so no
      // separate metadata-update is needed on this path.
      actions.push({
        kind: "supersede",
        existingId: row.id,
        node,
        revisionNumber: row.revisionNumber + 1,
      });
    } else if (row.isDeleted) {
      // Returning file — un-delete the same row. Any sharing drift on it is
      // picked up by the metadata-update branch on the NEXT scan (this row is
      // active again after this one), which keeps the un-delete a cheap bulk op.
      actions.push({ kind: "undelete", existingId: row.id });
    } else if (row.sharing !== node.sharing) {
      actions.push({ kind: "metadata-update", existingId: row.id, node });
    } else {
      actions.push({ kind: "unchanged", existingId: row.id });
    }
  }

  for (const row of existing) {
    // Already delete-marked and still gone: nothing to do. Re-marking it would
    // also make every subsequent scan report a non-zero `deleted`.
    if (!seen.has(row.driveId) && !row.isDeleted) {
      actions.push({ kind: "delete", existingId: row.id });
    }
  }

  return actions;
}
