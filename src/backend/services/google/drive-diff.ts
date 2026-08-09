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
}

export type DiffAction =
  | { kind: "create"; node: DriveNode }
  | { kind: "supersede"; existingId: number; node: DriveNode }
  | { kind: "delete"; existingId: number }
  | { kind: "unchanged"; existingId: number };

/**
 * @param live      every node currently in Drive under the root (post-exclusion)
 * @param existing  every ACTIVE, non-deleted row currently in D1 for that root
 * @param hashOf    content hash for a node — md5 for binaries, exported-text
 *                  sha-256 for Google-native files (Drive gives them no md5)
 */
export function diffNodes(
  live: DriveNode[],
  existing: ExistingRow[],
  hashOf: (node: DriveNode) => string,
): DiffAction[] {
  const byDriveId = new Map(existing.map((row) => [row.driveId, row]));
  const actions: DiffAction[] = [];
  const seen = new Set<string>();

  for (const node of live) {
    seen.add(node.driveId);
    const row = byDriveId.get(node.driveId);
    if (!row) {
      actions.push({ kind: "create", node });
      continue;
    }
    const changed =
      row.name !== node.name ||
      row.folderDriveId !== node.parentDriveId ||
      row.contentHash !== hashOf(node);
    actions.push(
      changed
        ? { kind: "supersede", existingId: row.id, node }
        : { kind: "unchanged", existingId: row.id },
    );
  }

  for (const row of existing) {
    if (!seen.has(row.driveId)) actions.push({ kind: "delete", existingId: row.id });
  }

  return actions;
}
