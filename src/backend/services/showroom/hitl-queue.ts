/**
 * @fileoverview Park-Finds HITL service (0032 D1) — the ONE path both the REST route
 * (`/api/showroom-hitl-queue`) and the MCP tools (`list_park_finds` /
 * `decide_park_find`) go through, so the Park-Finds page and a chat session decide
 * candidates through identical logic (AGENTS.md parity contract).
 *
 * A candidate is a place the proximity scan flagged at a park (decision 1.d). The two
 * terminal decisions:
 *   • PROCESS  → promote to a real `showroom_stores` row (or link an existing one by
 *                place_id), re-point the discovery visit + detour stop at it, and mark
 *                the candidate PROCESS.
 *   • DO_NOT_PROCESS → mark rejected and (optionally) drop a `showroom_exclusions` row
 *                so the same place never re-surfaces.
 *
 * Store name is JOINed on read — never denormalized onto the candidate row.
 */
import { driveLists } from "@backend/db/schema/drives/drive_lists";
import { driveListStops } from "@backend/db/schema/drives/drive_list_stops";
import { showroomExclusions } from "@backend/db/schema/showroom/exclusions";
import { showroomStoreHitlQueue } from "@backend/db/schema/showroom/store_hitl_queue";
import { showroomStores } from "@backend/db/schema/showroom/stores";
import { showroomVisitLog } from "@backend/db/schema/showroom/visit_log";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

export const HITL_DECISIONS = ["TBD", "PROCESS", "DO_NOT_PROCESS"] as const;
export type HitlDecision = (typeof HITL_DECISIONS)[number];

type Db = ReturnType<typeof drizzle>;

const selectCols = {
  id: showroomStoreHitlQueue.id,
  name: showroomStoreHitlQueue.name,
  description: showroomStoreHitlQueue.description,
  latitude: showroomStoreHitlQueue.latitude,
  longitude: showroomStoreHitlQueue.longitude,
  placeId: showroomStoreHitlQueue.placeId,
  storeId: showroomStoreHitlQueue.storeId,
  storeName: showroomStores.name,
  userDecision: showroomStoreHitlQueue.userDecision,
  driveListId: showroomStoreHitlQueue.driveListId,
  driveListTitle: driveLists.title,
  proximityScanJson: showroomStoreHitlQueue.proximityScanJson,
  categoryGuess: showroomStoreHitlQueue.categoryGuess,
  createdAt: showroomStoreHitlQueue.createdAt,
  updatedAt: showroomStoreHitlQueue.updatedAt,
} as const;

export interface ListHitlArgs {
  /** Filter by decision. Omit for all; the Park-Finds inbox passes "TBD". */
  decision?: HitlDecision;
  limit?: number;
}

export async function listHitlQueue(db: Db, args: ListHitlArgs = {}) {
  const rawLimit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : 200;
  const limit = Math.min(Math.max(rawLimit, 1), 500);
  const conds = [];
  if (args.decision) conds.push(eq(showroomStoreHitlQueue.userDecision, args.decision));
  return db
    .select(selectCols)
    .from(showroomStoreHitlQueue)
    .leftJoin(showroomStores, eq(showroomStoreHitlQueue.storeId, showroomStores.id))
    .leftJoin(driveLists, eq(showroomStoreHitlQueue.driveListId, driveLists.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(showroomStoreHitlQueue.createdAt))
    .limit(limit);
}

export async function getHitlCandidate(db: Db, id: number) {
  const [row] = await db
    .select(selectCols)
    .from(showroomStoreHitlQueue)
    .leftJoin(showroomStores, eq(showroomStoreHitlQueue.storeId, showroomStores.id))
    .leftJoin(driveLists, eq(showroomStoreHitlQueue.driveListId, driveLists.id))
    .where(eq(showroomStoreHitlQueue.id, id))
    .limit(1);
  return row ?? null;
}

/** Count TBD candidates — the Park-Finds sidebar badge. */
export async function countPending(db: Db): Promise<number> {
  const rows = await db
    .select({ id: showroomStoreHitlQueue.id })
    .from(showroomStoreHitlQueue)
    .where(eq(showroomStoreHitlQueue.userDecision, "TBD"))
    .all();
  return rows.length;
}

export interface DecideArgs {
  decision: Exclude<HitlDecision, "TBD">;
  /** DO_NOT_PROCESS: also add a permanent exclusion so it never re-surfaces. */
  addExclusion?: boolean;
  /** Reason note for the exclusion (markdown source of truth, html render cache). */
  reasonMarkdown?: string | null;
  reasonHtml?: string | null;
}

export interface DecideResult {
  ok: boolean;
  decision?: HitlDecision;
  storeId?: number;
  exclusionId?: number;
  reason?: "not-found" | "already-decided";
}

/**
 * Apply a terminal decision to a candidate. Idempotent-friendly: a candidate already
 * at the requested decision is a no-op success. Sequential writes with best-effort
 * relinking (D1 has no cross-statement transaction; the candidate row is the anchor).
 */
export async function decideHitlCandidate(
  db: Db,
  id: number,
  args: DecideArgs,
): Promise<DecideResult> {
  const [cand] = await db
    .select({
      id: showroomStoreHitlQueue.id,
      name: showroomStoreHitlQueue.name,
      latitude: showroomStoreHitlQueue.latitude,
      longitude: showroomStoreHitlQueue.longitude,
      placeId: showroomStoreHitlQueue.placeId,
      storeId: showroomStoreHitlQueue.storeId,
      userDecision: showroomStoreHitlQueue.userDecision,
      proximityScanJson: showroomStoreHitlQueue.proximityScanJson,
      categoryGuess: showroomStoreHitlQueue.categoryGuess,
    })
    .from(showroomStoreHitlQueue)
    .where(eq(showroomStoreHitlQueue.id, id))
    .limit(1);
  if (!cand) return { ok: false, reason: "not-found" };

  if (args.decision === "PROCESS") {
    // Reuse an existing store by place_id (the unique key) if one already exists,
    // else create one flagged as proximity-scan-originated.
    let storeId = cand.storeId ?? undefined;
    if (storeId == null && cand.placeId) {
      const [existing] = await db
        .select({ id: showroomStores.id })
        .from(showroomStores)
        .where(eq(showroomStores.placeId, cand.placeId))
        .limit(1);
      storeId = existing?.id;
    }
    if (storeId == null) {
      const [store] = await db
        .insert(showroomStores)
        .values({
          name: cand.name,
          latitude: cand.latitude,
          longitude: cand.longitude,
          placeId: cand.placeId,
          isIdentifiedByProximityScan: true,
          proximityScanJson: cand.proximityScanJson,
        })
        .returning({ id: showroomStores.id });
      storeId = store?.id;
    }
    if (storeId == null) return { ok: false, reason: "not-found" };

    await db
      .update(showroomStoreHitlQueue)
      .set({ userDecision: "PROCESS", storeId, updatedAt: new Date() })
      .where(eq(showroomStoreHitlQueue.id, id));

    // Re-point the discovery visit(s) + detour stop at the real store. The visit now
    // carries store_id and clears hitl_queue_id (the XOR resolves on confirm, D-2).
    await db
      .update(showroomVisitLog)
      .set({ storeId, hitlQueueId: null, updatedAt: new Date() })
      .where(eq(showroomVisitLog.hitlQueueId, id))
      .run();
    await db
      .update(driveListStops)
      .set({ showroomStoreId: storeId })
      .where(eq(driveListStops.hitlQueueId, id))
      .run();

    return { ok: true, decision: "PROCESS", storeId };
  }

  // DO_NOT_PROCESS
  await db
    .update(showroomStoreHitlQueue)
    .set({ userDecision: "DO_NOT_PROCESS", updatedAt: new Date() })
    .where(eq(showroomStoreHitlQueue.id, id));

  let exclusionId: number | undefined;
  if (args.addExclusion) {
    // Upsert the exclusion by place_id (partial-unique) so a re-reject is idempotent.
    if (cand.placeId) {
      const [existing] = await db
        .select({ id: showroomExclusions.id })
        .from(showroomExclusions)
        .where(and(eq(showroomExclusions.placeId, cand.placeId), isNotNull(showroomExclusions.placeId)))
        .limit(1);
      exclusionId = existing?.id;
    }
    if (exclusionId == null) {
      const [row] = await db
        .insert(showroomExclusions)
        .values({
          placeId: cand.placeId,
          name: cand.name,
          latitude: cand.latitude,
          longitude: cand.longitude,
          reasonMarkdown: args.reasonMarkdown ?? null,
          reasonHtml: args.reasonHtml ?? null,
          source: "manual",
        })
        .returning({ id: showroomExclusions.id });
      exclusionId = row?.id;
    }
  }

  return { ok: true, decision: "DO_NOT_PROCESS", exclusionId };
}
