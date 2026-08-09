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
import { and, eq, inArray } from "drizzle-orm";
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

function chunk<T>(values: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

export interface IngestSummary {
  rootId: number;
  label: string;
  seen: number;
  created: number;
  superseded: number;
  deleted: number;
  unchanged: number;
  errors: string[];
}

export async function ingestDriveFolder(env: Env, rootId: number): Promise<IngestSummary> {
  const db = drizzle(env.DB);

  const [root] = await db.select().from(driveRoots).where(eq(driveRoots.id, rootId)).limit(1);
  if (!root) throw new Error(`drive-ingest: no root ${rootId}`);

  const summary: IngestSummary = {
    rootId,
    label: root.label,
    seen: 0,
    created: 0,
    superseded: 0,
    deleted: 0,
    unchanged: 0,
    errors: [],
  };

  const exclusions = await db
    .select()
    .from(driveRootExclusions)
    .where(eq(driveRootExclusions.rootId, rootId));

  const nodes = await listFolderRecursive(env, root.driveFolderId, {
    excludedFolderIds: new Set(exclusions.filter((e) => e.kind === "folder").map((e) => e.value)),
    excludedMimePatterns: exclusions.filter((e) => e.kind === "mime").map((e) => e.value),
  });
  summary.seen = nodes.length;

  // ── Folders first: documents need their folder row id as an FK. ───────────
  const liveFolders = nodes.filter((n) => n.isFolder);
  await syncFolders(db, root, liveFolders, summary);

  // Drive id -> D1 folder row id, for the document FKs. Includes the root.
  const folderRows = await db
    .select({ id: driveFolders.id, driveId: driveFolders.driveId })
    .from(driveFolders)
    .where(and(eq(driveFolders.rootId, rootId), eq(driveFolders.isActive, true)));
  const folderIdByDriveId = new Map(folderRows.map((f) => [f.driveId, f.id]));

  await syncDocuments(
    db,
    env,
    root,
    nodes.filter((n) => !n.isFolder),
    folderIdByDriveId,
    summary,
  );

  await db
    .update(driveRoots)
    .set({ lastScannedAt: new Date(), updatedAt: new Date() })
    .where(eq(driveRoots.id, rootId));

  return summary;
}

async function syncFolders(
  db: ReturnType<typeof drizzle>,
  root: typeof driveRoots.$inferSelect,
  live: DriveNode[],
  summary: IngestSummary,
): Promise<void> {
  const existing = await db
    .select({
      id: driveFolders.id,
      driveId: driveFolders.driveId,
      name: driveFolders.name,
      parentFolderId: driveFolders.parentFolderId,
    })
    .from(driveFolders)
    .where(
      and(
        eq(driveFolders.rootId, root.id),
        eq(driveFolders.isActive, true),
        eq(driveFolders.isDeleted, false),
      ),
    );

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
      } else if (row.name !== node.name) {
        // Rename: sequential write + compensating reactivation on failure —
        // mirrors the document supersede path. db.batch() cannot feed the new
        // row's generated id forward and db.transaction() does not work on D1
        // (error 7500), so this cannot be one atomic unit; a read between the
        // two writes below is outside any atomic unit, and that gap is real.
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
          }
          summary.superseded++;
        } catch (err) {
          // Compensating write: never leave a row deactivated with no replacement.
          await db.update(driveFolders).set({ isActive: true }).where(eq(driveFolders.id, row.id));
          summary.errors.push(
            `rename ${node.name} (${node.driveId}): ${err instanceof Error ? err.message : String(err)}`,
          );
        }
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
  const goneIds = existing
    .filter((f) => !liveIds.has(f.driveId) && f.driveId !== root.driveFolderId)
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
  summary: IngestSummary,
): Promise<void> {
  const existingRows = await db
    .select({
      id: driveDocuments.id,
      driveId: driveDocuments.driveId,
      name: driveDocuments.name,
      contentHash: driveDocuments.contentHash,
      folderId: driveDocuments.folderId,
    })
    .from(driveDocuments)
    .where(
      and(
        eq(driveDocuments.rootId, root.id),
        eq(driveDocuments.isActive, true),
        eq(driveDocuments.isDeleted, false),
      ),
    );

  const folderDriveIdById = new Map([...folderIdByDriveId].map(([d, i]) => [i, d]));
  const existing: ExistingRow[] = existingRows.map((r) => ({
    id: r.id,
    driveId: r.driveId,
    name: r.name,
    contentHash: r.contentHash,
    folderDriveId: folderDriveIdById.get(r.folderId) ?? null,
  }));

  // Hash every live node up front so the diff stays pure. Failures are recorded
  // and the node is skipped — one bad export must not abort the whole scan.
  const hashes = new Map<string, { hash: string; source: string }>();
  for (const node of live) {
    try {
      hashes.set(node.driveId, await contentHashFor(env, node));
    } catch (err) {
      summary.errors.push(
        `hash ${node.name} (${node.driveId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const hashable = live.filter((n) => hashes.has(n.driveId));

  const actions = diffNodes(hashable, existing, (n) => hashes.get(n.driveId)?.hash ?? "");

  // FK lookup, not cast: driveDocuments.folderId is NOT NULL, so a document
  // whose parent folder didn't make it into the map (excluded, or any
  // folder-sync edge case) must be rejected rather than written with a
  // coerced/undefined value — see the repo's FK doctrine.
  const folderIdFor = (node: DriveNode): number | undefined =>
    folderIdByDriveId.get(node.parentDriveId ?? root.driveFolderId);

  const rowFor = (node: DriveNode, folderId: number): typeof driveDocuments.$inferInsert => ({
    driveId: node.driveId,
    rootId: root.id,
    folderId,
    name: node.name,
    mimeType: node.mimeType,
    sizeBytes: node.sizeBytes,
    contentHash: hashes.get(node.driveId)?.hash as string,
    hashSource: hashes.get(node.driveId)?.source as string,
    webViewUrl: node.webViewUrl,
    sharing: node.sharing,
    driveModifiedAt: node.modifiedAt,
    driveCreatedAt: node.createdAt,
  });

  const creates = actions.filter((a) => a.kind === "create");
  for (const part of chunk(creates)) {
    const rows: (typeof driveDocuments.$inferInsert)[] = [];
    for (const a of part) {
      const node = (a as { node: DriveNode }).node;
      const folderId = folderIdFor(node);
      if (folderId == null) {
        summary.errors.push(
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
      summary.errors.push(
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
        .values({ ...rowFor(action.node, folderId), revisionNumber: 1 })
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
      summary.errors.push(
        `supersede ${action.node.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const deletes = actions
    .filter((a) => a.kind === "delete")
    .map((a) => (a as { existingId: number }).existingId);
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
      out.push({
        rootId: root.id,
        label: root.label,
        seen: 0,
        created: 0,
        superseded: 0,
        deleted: 0,
        unchanged: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      });
    }
  }
  return out;
}
