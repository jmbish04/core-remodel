/**
 * @fileoverview Ingest one Drive root into D1.
 *
 * Generic on purpose: `ingestDriveFolder(env, rootId)` works for any root row,
 * so adding a folder is an INSERT, not a code change. The root's use case
 * decides which downstream pipeline (PR 2 email, PR 3 embeddings) consumes the
 * rows; this service is only responsible for the catalogue.
 *
 * D1 constraints shape every write here:
 *   - `db.transaction()` does not work on D1 (error 7500) — `db.batch()` only.
 *   - a statement caps at 100 bound parameters, so writes chunk at 20 rows.
 */
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  driveDocuments,
  driveFolders,
  driveRootExclusions,
  driveRoots,
} from "../../db/schema/google-drive/index";
import { contentHashFor, listFolderRecursive, type DriveNode } from "./drive";
import { diffNodes, type ExistingRow } from "./drive-diff";

/** D1 rejects a statement with >100 bound params; 20 rows is safe for these widths. */
const CHUNK = 20;

/** `errors` is written verbatim into the agent-run ledger — it must be bounded. */
const ERROR_CAP = 50;

/** A lease older than this is assumed abandoned, so a crashed scan self-heals. */
const SCAN_LEASE_MS = 30 * 60 * 1000;

function chunk<T>(values: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

/** Thrown when another scan already holds this root's lease. The route maps it to 409. */
export class ScanInProgressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScanInProgressError";
  }
}

export interface IngestSummary {
  rootId: number;
  label: string;
  seen: number;
  created: number;
  superseded: number;
  /** Rows that were delete-marked and came back — same row, flag cleared. */
  undeleted: number;
  deleted: number;
  unchanged: number;
  errors: string[];
  /** Errors past `ERROR_CAP` that were dropped rather than stored. */
  errorsTruncated: number;
}

export function emptySummary(rootId: number, label: string): IngestSummary {
  return {
    rootId,
    label,
    seen: 0,
    created: 0,
    superseded: 0,
    undeleted: 0,
    deleted: 0,
    unchanged: 0,
    errors: [],
    errorsTruncated: 0,
  };
}

/**
 * Append an error, capped.
 *
 * A root that is broken in a way that fails every node would otherwise write
 * one string per node into D1 via `run.succeed({ summaries })`. The cap keeps
 * the ledger row bounded; the trailing marker keeps the count honest.
 */
function pushError(summary: IngestSummary, message: string): void {
  if (summary.errors.length < ERROR_CAP) {
    summary.errors.push(message);
    return;
  }
  summary.errorsTruncated++;
  const marker = `…${summary.errorsTruncated} more error(s) suppressed`;
  if (summary.errors.length === ERROR_CAP) summary.errors.push(marker);
  else summary.errors[ERROR_CAP] = marker;
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Take this root's scan lease, atomically.
 *
 * One conditional UPDATE, not read-then-write: D1 has no transactions, so a
 * separate read would leave exactly the race this is here to close. An empty
 * RETURNING means someone else holds a lease that has not gone stale.
 */
async function acquireScanLease(db: ReturnType<typeof drizzle>, rootId: number): Promise<boolean> {
  const staleBefore = new Date(Date.now() - SCAN_LEASE_MS);
  const claimed = await db
    .update(driveRoots)
    .set({ scanStartedAt: new Date() })
    .where(
      and(
        eq(driveRoots.id, rootId),
        or(isNull(driveRoots.scanStartedAt), lt(driveRoots.scanStartedAt, staleBefore)),
      ),
    )
    .returning({ id: driveRoots.id });
  return claimed.length > 0;
}

export async function ingestDriveFolder(env: Env, rootId: number): Promise<IngestSummary> {
  const db = drizzle(env.DB);

  const [root] = await db.select().from(driveRoots).where(eq(driveRoots.id, rootId)).limit(1);
  if (!root) throw new Error(`drive-ingest: no root ${rootId}`);

  if (!(await acquireScanLease(db, rootId))) {
    throw new ScanInProgressError(
      `drive-ingest: root ${rootId} (${root.label}) is already being scanned ` +
        `(lease taken ${root.scanStartedAt?.toISOString() ?? "recently"})`,
    );
  }

  const summary = emptySummary(rootId, root.label);

  try {
    const exclusions = await db
      .select()
      .from(driveRootExclusions)
      .where(eq(driveRootExclusions.rootId, rootId));

    const nodes = await listFolderRecursive(env, root.driveFolderId, {
      excludedFolderIds: new Set(exclusions.filter((e) => e.kind === "folder").map((e) => e.value)),
      excludedMimePatterns: exclusions.filter((e) => e.kind === "mime").map((e) => e.value),
    });
    summary.seen = nodes.length;

    // ── Folders first: documents need their folder row id as an FK. ─────────
    const liveFolders = nodes.filter((n) => n.isFolder);
    await syncFolders(db, root, liveFolders, summary);

    // Two maps over the SAME rows, for two different jobs:
    //   folderIdByDriveId — ACTIVE rows only; what a document's FK points at.
    //   folderDriveIdById — EVERY row, active or not; how a document's stored
    //     folderId is resolved back to a Drive id. Restricting this one to
    //     active rows made a folder rename look like a move of every document
    //     inside it (the old folder row's id vanished from the map, so each
    //     child resolved to null and was superseded for nothing).
    const folderRows = await db
      .select({
        id: driveFolders.id,
        driveId: driveFolders.driveId,
        isActive: driveFolders.isActive,
      })
      .from(driveFolders)
      .where(eq(driveFolders.rootId, rootId));
    const folderIdByDriveId = new Map(
      folderRows.filter((f) => f.isActive).map((f) => [f.driveId, f.id]),
    );
    const folderDriveIdById = new Map(folderRows.map((f) => [f.id, f.driveId]));

    await syncDocuments(
      db,
      env,
      root,
      nodes.filter((n) => !n.isFolder),
      folderIdByDriveId,
      folderDriveIdById,
      summary,
    );

    await db
      .update(driveRoots)
      .set({ lastScannedAt: new Date(), updatedAt: new Date() })
      .where(eq(driveRoots.id, rootId));

    return summary;
  } finally {
    // Release the lease whatever happened, so a thrown scan does not block the
    // root for the full staleness window.
    await db.update(driveRoots).set({ scanStartedAt: null }).where(eq(driveRoots.id, rootId));
  }
}

async function syncFolders(
  db: ReturnType<typeof drizzle>,
  root: typeof driveRoots.$inferSelect,
  live: DriveNode[],
  summary: IngestSummary,
): Promise<void> {
  // EVERY row for this root, not just the live ones. Two reasons:
  //   - a delete-marked row must stay visible, or a file that comes back reads
  //     as new and mints a second active row for the same Drive id;
  //   - a superseded row is still the parent recorded on its children, so the
  //     id -> driveId map has to cover it.
  const allRows = await db
    .select({
      id: driveFolders.id,
      driveId: driveFolders.driveId,
      name: driveFolders.name,
      parentFolderId: driveFolders.parentFolderId,
      isActive: driveFolders.isActive,
      isDeleted: driveFolders.isDeleted,
    })
    .from(driveFolders)
    .where(eq(driveFolders.rootId, root.id));

  const existing = allRows.filter((f) => f.isActive);
  const driveIdById = new Map(allRows.map((f) => [f.id, f.driveId]));
  const parentDriveIdOf = (row: { parentFolderId: number | null }): string | null =>
    row.parentFolderId == null ? null : (driveIdById.get(row.parentFolderId) ?? null);

  // Ensure the root itself has a row — documents directly under it need an FK.
  if (!existing.some((f) => f.driveId === root.driveFolderId)) {
    await db.insert(driveFolders).values({
      driveId: root.driveFolderId,
      rootId: root.id,
      parentFolderId: null,
      name: root.label,
      webViewUrl: `https://drive.google.com/drive/folders/${root.driveFolderId}`,
      sharing: "PRIVATE",
    });
  }

  const byDriveId = new Map(existing.map((f) => [f.driveId, f]));
  const undeleteIds: number[] = [];

  for (const part of chunk(live)) {
    const creates: (typeof driveFolders.$inferInsert)[] = [];
    for (const node of part) {
      const row = byDriveId.get(node.driveId);
      if (!row) {
        creates.push({
          driveId: node.driveId,
          rootId: root.id,
          parentFolderId: null, // linked in the reparent pass below
          name: node.name,
          webViewUrl: node.webViewUrl,
          sharing: node.sharing,
          driveModifiedAt: node.modifiedAt,
        });
      } else if (row.name !== node.name || parentDriveIdOf(row) !== node.parentDriveId) {
        // Renamed OR moved — the spec treats both as a revision, and the
        // document path already did. Reparenting a folder in place would leave
        // no record that the tree changed shape.
        //
        // Sequential write + compensating reactivation on failure: db.batch()
        // cannot feed the new row's generated id forward and db.transaction()
        // does not work on D1 (error 7500), so this cannot be one atomic unit;
        // a read between the two writes below is outside any atomic unit, and
        // that gap is real.
        await db
          .update(driveFolders)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(driveFolders.id, row.id));
        try {
          const [inserted] = await db
            .insert(driveFolders)
            .values({
              driveId: node.driveId,
              rootId: root.id,
              parentFolderId: null,
              name: node.name,
              webViewUrl: node.webViewUrl,
              sharing: node.sharing,
              driveModifiedAt: node.modifiedAt,
            })
            .returning({ id: driveFolders.id });
          if (inserted) {
            await db
              .update(driveFolders)
              .set({ supersededById: inserted.id })
              .where(eq(driveFolders.id, row.id));
            // Move the children onto the live row. Documents keep pointing at
            // the superseded folder otherwise, so /documents would join the
            // stale name. This is a reparent, NOT a revision: the documents
            // themselves did not change.
            await db
              .update(driveDocuments)
              .set({ folderId: inserted.id })
              .where(eq(driveDocuments.folderId, row.id));
            driveIdById.set(inserted.id, node.driveId);
          }
          summary.superseded++;
        } catch (err) {
          // Compensating write: never leave a row deactivated with no replacement.
          await db.update(driveFolders).set({ isActive: true }).where(eq(driveFolders.id, row.id));
          pushError(summary, `supersede folder ${node.name} (${node.driveId}): ${errText(err)}`);
        }
      } else if (row.isDeleted) {
        // Back from the dead: same row, flag cleared. Creating a new row here
        // is what produced duplicate active rows for one Drive id.
        undeleteIds.push(row.id);
      } else {
        summary.unchanged++;
      }
    }
    if (creates.length > 0) {
      const stmts = creates.map((v) => db.insert(driveFolders).values(v));
      await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
      summary.created += creates.length;
    }
  }

  for (const part of chunk(undeleteIds)) {
    if (part.length === 0) continue;
    await db
      .update(driveFolders)
      .set({ isDeleted: false, updatedAt: new Date() })
      .where(inArray(driveFolders.id, part));
    summary.undeleted += part.length;
  }

  // Reparent pass: parents are only resolvable once every folder row exists.
  const all = await db
    .select({ id: driveFolders.id, driveId: driveFolders.driveId })
    .from(driveFolders)
    .where(and(eq(driveFolders.rootId, root.id), eq(driveFolders.isActive, true)));
  const idByDriveId = new Map(all.map((f) => [f.driveId, f.id]));

  for (const node of live) {
    const selfId = idByDriveId.get(node.driveId);
    const parentId = node.parentDriveId ? idByDriveId.get(node.parentDriveId) : undefined;
    if (selfId && parentId) {
      await db
        .update(driveFolders)
        .set({ parentFolderId: parentId })
        .where(eq(driveFolders.id, selfId));
    }
  }

  // Folders gone from Drive.
  const liveIds = new Set(live.map((n) => n.driveId));
  // Already delete-marked rows are skipped — re-marking them would report a
  // non-zero `deleted` on every subsequent scan of an unchanged tree.
  const goneIds = existing
    .filter((f) => !liveIds.has(f.driveId) && !f.isDeleted && f.driveId !== root.driveFolderId)
    .map((f) => f.id);
  for (const part of chunk(goneIds)) {
    if (part.length === 0) continue;
    await db
      .update(driveFolders)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(inArray(driveFolders.id, part));
    summary.deleted += part.length;
  }
}

async function syncDocuments(
  db: ReturnType<typeof drizzle>,
  env: Env,
  root: typeof driveRoots.$inferSelect,
  live: DriveNode[],
  folderIdByDriveId: Map<string, number>,
  folderDriveIdById: Map<number, string>,
  summary: IngestSummary,
): Promise<void> {
  // No isDeleted filter — see the note on diffNodes' `existing` parameter.
  const existingRows = await db
    .select({
      id: driveDocuments.id,
      driveId: driveDocuments.driveId,
      name: driveDocuments.name,
      contentHash: driveDocuments.contentHash,
      hashSource: driveDocuments.hashSource,
      folderId: driveDocuments.folderId,
      isDeleted: driveDocuments.isDeleted,
      revisionNumber: driveDocuments.revisionNumber,
    })
    .from(driveDocuments)
    .where(and(eq(driveDocuments.rootId, root.id), eq(driveDocuments.isActive, true)));

  const existing: ExistingRow[] = existingRows.map((r) => ({
    id: r.id,
    driveId: r.driveId,
    name: r.name,
    contentHash: r.contentHash,
    hashSource: r.hashSource,
    isDeleted: r.isDeleted,
    revisionNumber: r.revisionNumber,
    folderDriveId: folderDriveIdById.get(r.folderId) ?? null,
  }));

  // Hash every live node up front so the diff stays pure. Failures are recorded
  // and the node is skipped — one bad export must not abort the whole scan, and
  // skipping leaves the previous row exactly as it was.
  const hashes = new Map<string, { hash: string; source: string }>();
  for (const node of live) {
    try {
      hashes.set(node.driveId, await contentHashFor(env, node));
    } catch (err) {
      pushError(summary, `hash ${node.name} (${node.driveId}): ${errText(err)}`);
    }
  }
  const hashable = live.filter((n) => hashes.has(n.driveId));

  // Non-null by construction: `hashable` is exactly the nodes present in the map.
  const hashFor = (node: DriveNode): { hash: string; source: string } => {
    const entry = hashes.get(node.driveId);
    if (!entry) throw new Error(`drive-ingest: no hash for ${node.driveId}`);
    return entry;
  };

  // Nodes we saw in Drive but could not hash this run. They are still THERE —
  // passing them through keeps a transient export failure from delete-marking
  // a live file.
  const unreadable = live.filter((n) => !hashes.has(n.driveId)).map((n) => n.driveId);

  const actions = diffNodes(hashable, existing, hashFor, unreadable);

  // FK lookup, not cast: driveDocuments.folderId is NOT NULL, so a document
  // whose parent folder didn't make it into the map (excluded, or any
  // folder-sync edge case) must be rejected rather than written with a
  // coerced/undefined value — see the repo's FK doctrine.
  const folderIdFor = (node: DriveNode): number | undefined =>
    folderIdByDriveId.get(node.parentDriveId ?? root.driveFolderId);

  // No `as string` casts: the hash is looked up and narrowed, so a missing
  // entry throws where it happens instead of writing `undefined` into a
  // NOT NULL column.
  const rowFor = (node: DriveNode, folderId: number): typeof driveDocuments.$inferInsert => {
    const { hash, source } = hashFor(node);
    return {
      driveId: node.driveId,
      rootId: root.id,
      folderId,
      name: node.name,
      mimeType: node.mimeType,
      sizeBytes: node.sizeBytes,
      contentHash: hash,
      hashSource: source,
      webViewUrl: node.webViewUrl,
      sharing: node.sharing,
      driveModifiedAt: node.modifiedAt,
      driveCreatedAt: node.createdAt,
    };
  };

  const creates = actions.filter((a) => a.kind === "create");
  for (const part of chunk(creates)) {
    const rows: (typeof driveDocuments.$inferInsert)[] = [];
    for (const { node } of part) {
      const folderId = folderIdFor(node);
      if (folderId == null) {
        pushError(
          summary,
          `create ${node.name} (${node.driveId}): no folder row for parent ${node.parentDriveId ?? root.driveFolderId}`,
        );
        continue;
      }
      rows.push(rowFor(node, folderId));
    }
    if (rows.length === 0) continue;
    const stmts = rows.map((v) => db.insert(driveDocuments).values(v));
    await db.batch(stmts as [(typeof stmts)[number], ...(typeof stmts)[number][]]);
    summary.created += rows.length;
  }

  // Supersede: deactivate the old row, then insert the replacement. These
  // cannot be one batch — the new row's id is not known until it is written —
  // so on insert failure the deactivation is rolled back by hand. A read
  // between the two writes is outside any atomic unit; that gap is real.
  for (const action of actions) {
    if (action.kind !== "supersede") continue;
    const folderId = folderIdFor(action.node);
    if (folderId == null) {
      pushError(
        summary,
        `supersede ${action.node.name} (${action.node.driveId}): no folder row for parent ${action.node.parentDriveId ?? root.driveFolderId}`,
      );
      continue;
    }
    await db
      .update(driveDocuments)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(driveDocuments.id, action.existingId));
    try {
      const [inserted] = await db
        .insert(driveDocuments)
        // The chain has to count: every row in a five-deep chain read
        // "revision 1" while this was hardcoded (also the column default).
        .values({ ...rowFor(action.node, folderId), revisionNumber: action.revisionNumber })
        .returning({ id: driveDocuments.id });
      if (inserted) {
        await db
          .update(driveDocuments)
          .set({ supersededById: inserted.id })
          .where(eq(driveDocuments.id, action.existingId));
      }
      summary.superseded++;
    } catch (err) {
      // Compensating write: never leave a row deactivated with no replacement.
      await db
        .update(driveDocuments)
        .set({ isActive: true })
        .where(eq(driveDocuments.id, action.existingId));
      pushError(summary, `supersede ${action.node.name}: ${errText(err)}`);
    }
  }

  // Un-delete: the row is still there and still correct, so clear the flag
  // rather than minting a second active row for the same Drive id.
  const undeletes = actions.filter((a) => a.kind === "undelete").map((a) => a.existingId);
  for (const part of chunk(undeletes)) {
    if (part.length === 0) continue;
    await db
      .update(driveDocuments)
      .set({ isDeleted: false, updatedAt: new Date() })
      .where(inArray(driveDocuments.id, part));
    summary.undeleted += part.length;
  }

  const deletes = actions.filter((a) => a.kind === "delete").map((a) => a.existingId);
  for (const part of chunk(deletes)) {
    if (part.length === 0) continue;
    await db
      .update(driveDocuments)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(inArray(driveDocuments.id, part));
    summary.deleted += part.length;
  }

  summary.unchanged += actions.filter((a) => a.kind === "unchanged").length;
}

/** Active roots, for a caller that wants to wrap each scan in its own step. */
export async function listActiveRootsForCron(env: Env): Promise<{ id: number; label: string }[]> {
  const db = drizzle(env.DB);
  return db
    .select({ id: driveRoots.id, label: driveRoots.label })
    .from(driveRoots)
    .where(eq(driveRoots.isActive, true));
}

/** Every active root, sequentially. One root's failure must not stop the rest. */
export async function ingestAllActiveRoots(env: Env): Promise<IngestSummary[]> {
  const db = drizzle(env.DB);
  const roots = await db.select().from(driveRoots).where(eq(driveRoots.isActive, true));
  const out: IngestSummary[] = [];
  for (const root of roots) {
    try {
      out.push(await ingestDriveFolder(env, root.id));
    } catch (err) {
      const summary = emptySummary(root.id, root.label);
      pushError(summary, errText(err));
      out.push(summary);
    }
  }
  return out;
}
