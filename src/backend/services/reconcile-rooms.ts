/**
 * @fileoverview reconcileRooms — idempotent, transactional room-data service.
 *
 * Purpose
 * -------
 * The room reconciliation pass for feature 0005 must repoint every FK that
 * references `rooms.id` from a source room to a target room before deleting
 * the source.  This service encodes that logic once, used by:
 *   1. scripts/0005-reconcile-rooms.ts  (one-off data-fix script, T0.3)
 *   2. Future admin API endpoints        (Room Management panel, T0.6+)
 *
 * Design constraints (cloudflare-jedi golden rules)
 * --------------------------------------------------
 * - D1 is SQLite: no transactions across batches longer than ~100 statements.
 *   We keep each operation to a bounded write set and batch within D1 limits.
 * - Every public function is idempotent: safe to call twice.  Guards use
 *   WHERE-condition checks (e.g. "does the row exist before deleting it?")
 *   so re-runs skip work already done rather than error-ing.
 * - FK repointing always happens BEFORE any DELETE to preserve referential
 *   integrity in case a run is interrupted mid-way.
 * - Uniqueness constraints that would block naive UPDATE statements are
 *   handled with skip-or-delete logic described per function.
 *
 * FK table inventory (discovered by grep + runtime sqlite_master check)
 * ---------------------------------------------------------------------
 * The following tables reference rooms.id via a room_id column.  The script
 * must repoint ALL of them on merge.  Known set as of 2026-06-19:
 *
 *   images.room_id                        (set null on delete)
 *   inspirational_image_rooms.room_id     (cascade; unique(image_id, room_id))
 *   listing_photos.room_id                (restrict on delete)
 *   supporting_document_room_mappings.room_id (cascade; unique(doc_id, room_id))
 *   room_action_items.room_id             (cascade)
 *   room_ai_summaries.room_id             (cascade; unique(room_id))
 *   scenario_room_plans.room_id           (cascade)
 *   budget_tracker_item_rooms.room_id     (cascade)
 *   planning_tasks.room_id                (set null on delete)
 *   standard_costs.room_id                (cascade; nullable)
 *   estimate_room_mappings.room_id        (cascade)
 *   vision_node_room_mappings.room_id     (cascade; unique(node_id, room_id))
 *   bid_portfolio_room_configs.room_id    (cascade)
 *   bid_portfolio_comments.room_id        (set null on delete)
 *   bid_portfolio_selected_photos.room_id (cascade)
 *   checklist_room_mappings.room_id       (cascade; unique(question_id, room_id))
 *   room_material_quotes.room_id          (cascade)
 *   render_canvases.room_id               (set null on delete)
 *   render_sessions.room_id               (set null on delete)
 *   mood_board_generations.room_id        (set null on delete)
 *
 * Tables with unique constraints that need dedupe logic on merge:
 *   inspirational_image_rooms  — unique(image_id, room_id): skip rows whose
 *                                 (image_id, target) pair already exists.
 *   room_ai_summaries          — unique(room_id): keep the target's row (or the
 *                                 most recently-generated one) and delete source's.
 *   supporting_document_room_mappings — unique(doc_id, room_id): skip dupes.
 *   vision_node_room_mappings  — unique(node_id, room_id): skip dupes.
 *   checklist_room_mappings    — unique(question_id, room_id): skip dupes.
 */

import { and, eq, inArray, not } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  bidPortfolioComments,
  bidPortfolioRoomConfigs,
  bidPortfolioSelectedPhotos,
  budgetTrackerItemRooms,
  checklistRoomMappings,
  estimateRoomMappings,
  floors,
  images,
  inspirationalImageRooms,
  listingPhotos,
  moodBoardGenerations,
  planningTasks,
  renderCanvases,
  renderSessions,
  roomActionItems,
  roomAiSummaries,
  roomMaterialQuotes,
  rooms,
  scenarioRoomPlans,
  standardCosts,
  supportingDocumentRoomMappings,
  visionNodeRoomMappings,
} from "@backend/db";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Drizzle DB instance type (D1 flavour). */
type DB = ReturnType<typeof drizzle>;

export interface RenameRoomOptions {
  /** New room_code slug (kebab-case). Must be globally unique. */
  newCode?: string;
  /** New display name. */
  newName?: string;
  /** If provided, also update floorplan_floor_key to this floor key. */
  floorKey?: string | null;
}

export interface SetFloorplanPositionOptions {
  /** Floor key for the dot canvas: "lower_level" | "upper_level" | "outside". */
  floorKey: string | null;
  /** Horizontal position 0–100 (percent of image width). null = no dot. */
  xPct: number | null;
  /** Vertical position 0–100 (percent of image height). null = no dot. */
  yPct: number | null;
}

export interface MergeRoomsResult {
  sourceId: number;
  targetId: number;
  rowsRepointed: Record<string, number>;
  sourceDeleted: boolean;
}

export interface ReassignImagesResult {
  imageIds: string[];
  targetRoomId: number;
  rowsUpdated: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Look up a room by numeric id OR by room_code slug.
 * Throws if the room cannot be found.
 */
async function resolveRoom(
  db: DB,
  identifier: number | string,
): Promise<typeof rooms.$inferSelect> {
  let row: typeof rooms.$inferSelect | undefined;

  if (typeof identifier === "number") {
    row = await db.select().from(rooms).where(eq(rooms.id, identifier)).get();
  } else {
    row = await db.select().from(rooms).where(eq(rooms.roomCode, identifier)).get();
  }

  if (!row) {
    throw new Error(`Room not found: ${JSON.stringify(identifier)}`);
  }
  return row;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Rename a room's code, display name, and/or floor assignment.
 *
 * Idempotent: if the room already has the requested code/name, the UPDATE
 * is a no-op.  Does not touch any child rows — this is a pure rooms-table
 * operation.
 *
 * @param db      Drizzle DB instance.
 * @param code    Current room_code (or numeric id) to find the room.
 * @param options Fields to update; any omitted field is left unchanged.
 *
 * @example
 *   await renameRoom(db, "lower-bedroom-1", {
 *     newCode: "lower-guest-bedroom",
 *     newName: "Guest Bedroom",
 *   });
 */
export async function renameRoom(
  db: DB,
  code: string | number,
  options: RenameRoomOptions,
): Promise<void> {
  const room = await resolveRoom(db, code);

  // Build the update payload — only the fields the caller specified.
  const patch: Partial<typeof rooms.$inferInsert> = {};
  if (options.newCode !== undefined) patch.roomCode = options.newCode;
  if (options.newName !== undefined) patch.roomName = options.newName;
  if (options.floorKey !== undefined) {
    // Look up the floor id for the given key so we can update floorId too.
    if (options.floorKey !== null) {
      const targetFloor = await db
        .select()
        .from(floors)
        .where(eq(floors.key, options.floorKey))
        .get();
      if (!targetFloor) {
        throw new Error(`Floor not found for key: ${options.floorKey}`);
      }
      patch.floorId = targetFloor.id;
    }
    patch.floorplanFloorKey = options.floorKey;
  }

  if (Object.keys(patch).length === 0) {
    return; // Nothing to do.
  }

  await db.update(rooms).set(patch).where(eq(rooms.id, room.id)).run();
}

/**
 * Update (or clear) the floorplan dot position for a room.
 *
 * Setting xPct/yPct to null removes the dot from the canvas while keeping
 * the floor-key grouping for sidebar display.  Setting both to null AND
 * floorKey to null removes the room from all floorplan rendering entirely
 * (sidebar "Unplaced" group).
 *
 * Idempotent.
 *
 * @param db      Drizzle DB instance.
 * @param code    Room code or numeric id.
 * @param opts    New floor key + coordinate percentages.
 */
export async function setFloorplanPosition(
  db: DB,
  code: string | number,
  opts: SetFloorplanPositionOptions,
): Promise<void> {
  const room = await resolveRoom(db, code);

  await db
    .update(rooms)
    .set({
      floorplanFloorKey: opts.floorKey,
      floorplanXPct: opts.xPct,
      floorplanYPct: opts.yPct,
    })
    .where(eq(rooms.id, room.id))
    .run();
}

/**
 * Merge all references from a source room into a target room, then delete
 * the source room record.
 *
 * Order of operations
 * -------------------
 * 1. Resolve source + target ids.
 * 2. Repoint simple FK tables (images, listing_photos, planning_tasks, etc.)
 *    — rows that had source.id now get target.id.
 * 3. Dedupe-repoint constrained tables:
 *    a. inspirational_image_rooms — skip (image_id, target) rows that already exist;
 *       delete those skipped source rows so the DELETE in step 4 succeeds.
 *    b. room_ai_summaries — keep the target's row (or most-recently generated);
 *       delete the source's.
 *    c. supporting_document_room_mappings — skip (doc_id, target) rows that already exist.
 *    d. vision_node_room_mappings — skip (node_id, target) rows that already exist.
 *    e. checklist_room_mappings — skip (question_id, target) rows that already exist.
 * 4. Delete the source room record.
 *
 * Idempotent: if the source room no longer exists (already deleted), returns
 * early with sourceDeleted=false in the result.
 *
 * @param db           Drizzle DB instance.
 * @param sourceIdOrCode  Source room to be merged away and deleted.
 * @param targetIdOrCode  Target room that receives all the source's references.
 */
export async function mergeRooms(
  db: DB,
  sourceIdOrCode: number | string,
  targetIdOrCode: number | string,
): Promise<MergeRoomsResult> {
  // ------------------------------------------------------------------
  // 1. Resolve rooms
  // ------------------------------------------------------------------
  let source: typeof rooms.$inferSelect;
  try {
    source = await resolveRoom(db, sourceIdOrCode);
  } catch {
    // Source already gone — idempotent early return.
    const target = await resolveRoom(db, targetIdOrCode);
    return {
      sourceId: typeof sourceIdOrCode === "number" ? sourceIdOrCode : -1,
      targetId: target.id,
      rowsRepointed: {},
      sourceDeleted: false,
    };
  }
  const target = await resolveRoom(db, targetIdOrCode);
  const sourceId = source.id;
  const targetId = target.id;

  if (sourceId === targetId) {
    throw new Error(`Cannot merge room into itself (id=${sourceId})`);
  }

  const rowsRepointed: Record<string, number> = {};

  // ------------------------------------------------------------------
  // 2. Repoint simple FK tables (no unique constraints to worry about)
  // ------------------------------------------------------------------

  // images.room_id (nullable, set null on delete)
  await db
    .update(images)
    .set({ roomId: targetId })
    .where(eq(images.roomId, sourceId))
    .run();
  rowsRepointed["images"] = 0; // D1 doesn't return affected rows on update

  // listing_photos.room_id (restrict on delete — MUST repoint before delete)
  await db
    .update(listingPhotos)
    .set({ roomId: targetId })
    .where(eq(listingPhotos.roomId, sourceId))
    .run();
  rowsRepointed["listing_photos"] = 0;

  // planning_tasks.room_id (nullable, set null on delete)
  await db
    .update(planningTasks)
    .set({ roomId: targetId })
    .where(eq(planningTasks.roomId, sourceId))
    .run();
  rowsRepointed["planning_tasks"] = 0;

  // room_action_items.room_id (cascade)
  await db
    .update(roomActionItems)
    .set({ roomId: targetId })
    .where(eq(roomActionItems.roomId, sourceId))
    .run();
  rowsRepointed["room_action_items"] = 0;

  // scenario_room_plans.room_id (cascade)
  await db
    .update(scenarioRoomPlans)
    .set({ roomId: targetId })
    .where(eq(scenarioRoomPlans.roomId, sourceId))
    .run();
  rowsRepointed["scenario_room_plans"] = 0;

  // budget_tracker_item_rooms.room_id (cascade)
  await db
    .update(budgetTrackerItemRooms)
    .set({ roomId: targetId })
    .where(eq(budgetTrackerItemRooms.roomId, sourceId))
    .run();
  rowsRepointed["budget_tracker_item_rooms"] = 0;

  // standard_costs.room_id (cascade, nullable)
  await db
    .update(standardCosts)
    .set({ roomId: targetId })
    .where(eq(standardCosts.roomId, sourceId))
    .run();
  rowsRepointed["standard_costs"] = 0;

  // estimate_room_mappings.room_id (cascade)
  await db
    .update(estimateRoomMappings)
    .set({ roomId: targetId })
    .where(eq(estimateRoomMappings.roomId, sourceId))
    .run();
  rowsRepointed["estimate_room_mappings"] = 0;

  // bid_portfolio_room_configs.room_id (cascade)
  await db
    .update(bidPortfolioRoomConfigs)
    .set({ roomId: targetId })
    .where(eq(bidPortfolioRoomConfigs.roomId, sourceId))
    .run();
  rowsRepointed["bid_portfolio_room_configs"] = 0;

  // bid_portfolio_comments.room_id (set null on delete)
  await db
    .update(bidPortfolioComments)
    .set({ roomId: targetId })
    .where(eq(bidPortfolioComments.roomId, sourceId))
    .run();
  rowsRepointed["bid_portfolio_comments"] = 0;

  // bid_portfolio_selected_photos.room_id (cascade)
  await db
    .update(bidPortfolioSelectedPhotos)
    .set({ roomId: targetId })
    .where(eq(bidPortfolioSelectedPhotos.roomId, sourceId))
    .run();
  rowsRepointed["bid_portfolio_selected_photos"] = 0;

  // render_canvases.room_id (set null)
  await db
    .update(renderCanvases)
    .set({ roomId: targetId })
    .where(eq(renderCanvases.roomId, sourceId))
    .run();
  rowsRepointed["render_canvases"] = 0;

  // render_sessions.room_id (set null)
  await db
    .update(renderSessions)
    .set({ roomId: targetId })
    .where(eq(renderSessions.roomId, sourceId))
    .run();
  rowsRepointed["render_sessions"] = 0;

  // mood_board_generations.room_id (set null)
  await db
    .update(moodBoardGenerations)
    .set({ roomId: targetId })
    .where(eq(moodBoardGenerations.roomId, sourceId))
    .run();
  rowsRepointed["mood_board_generations"] = 0;

  // room_material_quotes.room_id (cascade)
  await db
    .update(roomMaterialQuotes)
    .set({ roomId: targetId })
    .where(eq(roomMaterialQuotes.roomId, sourceId))
    .run();
  rowsRepointed["room_material_quotes"] = 0;

  // ------------------------------------------------------------------
  // 3a. inspirational_image_rooms — unique(image_id, room_id)
  //
  // Strategy: fetch the source's image_ids, find which ones already exist
  // for the target, delete those source rows (they'd violate the unique
  // constraint on re-point), then repoint the remaining rows.
  // ------------------------------------------------------------------
  const sourceInspRows = await db
    .select({ id: inspirationalImageRooms.id, imageId: inspirationalImageRooms.imageId })
    .from(inspirationalImageRooms)
    .where(eq(inspirationalImageRooms.roomId, sourceId))
    .all();

  if (sourceInspRows.length > 0) {
    const sourceImageIds = sourceInspRows.map((r) => r.imageId);

    // Find image_ids that already have a mapping to the target room.
    const existingTargetRows = await db
      .select({ imageId: inspirationalImageRooms.imageId })
      .from(inspirationalImageRooms)
      .where(
        and(
          eq(inspirationalImageRooms.roomId, targetId),
          inArray(inspirationalImageRooms.imageId, sourceImageIds),
        ),
      )
      .all();

    const conflictingImageIds = new Set(existingTargetRows.map((r) => r.imageId));

    // Delete source rows that would conflict with the target's unique index.
    const conflictingSourceIds = sourceInspRows
      .filter((r) => conflictingImageIds.has(r.imageId))
      .map((r) => r.id);

    if (conflictingSourceIds.length > 0) {
      // Batch in chunks of 90 to respect D1's statement limits.
      for (let i = 0; i < conflictingSourceIds.length; i += 90) {
        const chunk = conflictingSourceIds.slice(i, i + 90);
        await db
          .delete(inspirationalImageRooms)
          .where(inArray(inspirationalImageRooms.id, chunk))
          .run();
      }
    }

    // Repoint the non-conflicting source rows.
    const safeSourceIds = sourceInspRows
      .filter((r) => !conflictingImageIds.has(r.imageId))
      .map((r) => r.id);

    if (safeSourceIds.length > 0) {
      for (let i = 0; i < safeSourceIds.length; i += 90) {
        const chunk = safeSourceIds.slice(i, i + 90);
        await db
          .update(inspirationalImageRooms)
          .set({ roomId: targetId })
          .where(inArray(inspirationalImageRooms.id, chunk))
          .run();
      }
    }
    rowsRepointed["inspirational_image_rooms"] = safeSourceIds.length;
  }

  // ------------------------------------------------------------------
  // 3b. room_ai_summaries — unique(room_id)
  //
  // Strategy: keep whichever row has a more-recent datetimeGenerated (the
  // target's if tied or null).  Delete the source's summary row.
  // ------------------------------------------------------------------
  const sourceSummary = await db
    .select()
    .from(roomAiSummaries)
    .where(eq(roomAiSummaries.roomId, sourceId))
    .get();

  if (sourceSummary) {
    const targetSummary = await db
      .select()
      .from(roomAiSummaries)
      .where(eq(roomAiSummaries.roomId, targetId))
      .get();

    if (!targetSummary) {
      // No target summary exists — repoint source summary to target.
      await db
        .update(roomAiSummaries)
        .set({ roomId: targetId })
        .where(eq(roomAiSummaries.id, sourceSummary.id))
        .run();
    } else {
      // Both exist.  Keep the most recently-generated; delete the other.
      const sourceGenAt = sourceSummary.datetimeGenerated?.getTime() ?? 0;
      const targetGenAt = targetSummary.datetimeGenerated?.getTime() ?? 0;

      if (sourceGenAt > targetGenAt) {
        // Source is newer — keep source, delete target, then repoint source.
        await db
          .delete(roomAiSummaries)
          .where(eq(roomAiSummaries.id, targetSummary.id))
          .run();
        await db
          .update(roomAiSummaries)
          .set({ roomId: targetId })
          .where(eq(roomAiSummaries.id, sourceSummary.id))
          .run();
      } else {
        // Target is newer (or equal) — just delete source's summary.
        await db
          .delete(roomAiSummaries)
          .where(eq(roomAiSummaries.id, sourceSummary.id))
          .run();
      }
    }
    rowsRepointed["room_ai_summaries"] = 1;
  }

  // ------------------------------------------------------------------
  // 3c. supporting_document_room_mappings — unique(doc_id, room_id)
  // ------------------------------------------------------------------
  const sourceDocRows = await db
    .select({
      id: supportingDocumentRoomMappings.id,
      docId: supportingDocumentRoomMappings.supportingDocumentId,
    })
    .from(supportingDocumentRoomMappings)
    .where(eq(supportingDocumentRoomMappings.roomId, sourceId))
    .all();

  if (sourceDocRows.length > 0) {
    const sourceDocIds = sourceDocRows.map((r) => r.docId);

    const existingTargetDocRows = await db
      .select({ docId: supportingDocumentRoomMappings.supportingDocumentId })
      .from(supportingDocumentRoomMappings)
      .where(
        and(
          eq(supportingDocumentRoomMappings.roomId, targetId),
          inArray(supportingDocumentRoomMappings.supportingDocumentId, sourceDocIds),
        ),
      )
      .all();

    const conflictingDocIds = new Set(existingTargetDocRows.map((r) => r.docId));

    const conflictingIds = sourceDocRows
      .filter((r) => conflictingDocIds.has(r.docId))
      .map((r) => r.id);
    if (conflictingIds.length > 0) {
      for (let i = 0; i < conflictingIds.length; i += 90) {
        const chunk = conflictingIds.slice(i, i + 90);
        await db
          .delete(supportingDocumentRoomMappings)
          .where(inArray(supportingDocumentRoomMappings.id, chunk))
          .run();
      }
    }

    const safeIds = sourceDocRows
      .filter((r) => !conflictingDocIds.has(r.docId))
      .map((r) => r.id);
    if (safeIds.length > 0) {
      for (let i = 0; i < safeIds.length; i += 90) {
        const chunk = safeIds.slice(i, i + 90);
        await db
          .update(supportingDocumentRoomMappings)
          .set({ roomId: targetId })
          .where(inArray(supportingDocumentRoomMappings.id, chunk))
          .run();
      }
    }
    rowsRepointed["supporting_document_room_mappings"] = safeIds.length;
  }

  // ------------------------------------------------------------------
  // 3d. vision_node_room_mappings — unique(node_id, room_id)
  // ------------------------------------------------------------------
  const sourceVisionRows = await db
    .select({
      id: visionNodeRoomMappings.id,
      nodeId: visionNodeRoomMappings.visionNodeId,
    })
    .from(visionNodeRoomMappings)
    .where(eq(visionNodeRoomMappings.roomId, sourceId))
    .all();

  if (sourceVisionRows.length > 0) {
    const sourceNodeIds = sourceVisionRows.map((r) => r.nodeId);

    const existingTargetVisionRows = await db
      .select({ nodeId: visionNodeRoomMappings.visionNodeId })
      .from(visionNodeRoomMappings)
      .where(
        and(
          eq(visionNodeRoomMappings.roomId, targetId),
          inArray(visionNodeRoomMappings.visionNodeId, sourceNodeIds),
        ),
      )
      .all();

    const conflictingNodeIds = new Set(existingTargetVisionRows.map((r) => r.nodeId));

    const conflictingIds = sourceVisionRows
      .filter((r) => conflictingNodeIds.has(r.nodeId))
      .map((r) => r.id);
    if (conflictingIds.length > 0) {
      for (let i = 0; i < conflictingIds.length; i += 90) {
        const chunk = conflictingIds.slice(i, i + 90);
        await db
          .delete(visionNodeRoomMappings)
          .where(inArray(visionNodeRoomMappings.id, chunk))
          .run();
      }
    }

    const safeIds = sourceVisionRows
      .filter((r) => !conflictingNodeIds.has(r.nodeId))
      .map((r) => r.id);
    if (safeIds.length > 0) {
      for (let i = 0; i < safeIds.length; i += 90) {
        const chunk = safeIds.slice(i, i + 90);
        await db
          .update(visionNodeRoomMappings)
          .set({ roomId: targetId })
          .where(inArray(visionNodeRoomMappings.id, chunk))
          .run();
      }
    }
    rowsRepointed["vision_node_room_mappings"] = safeIds.length;
  }

  // ------------------------------------------------------------------
  // 3e. checklist_room_mappings — unique(question_id, room_id)
  // ------------------------------------------------------------------
  const sourceCheckRows = await db
    .select({
      id: checklistRoomMappings.id,
      questionId: checklistRoomMappings.questionId,
    })
    .from(checklistRoomMappings)
    .where(eq(checklistRoomMappings.roomId, sourceId))
    .all();

  if (sourceCheckRows.length > 0) {
    const sourceQuestionIds = sourceCheckRows.map((r) => r.questionId);

    const existingTargetCheckRows = await db
      .select({ questionId: checklistRoomMappings.questionId })
      .from(checklistRoomMappings)
      .where(
        and(
          eq(checklistRoomMappings.roomId, targetId),
          inArray(checklistRoomMappings.questionId, sourceQuestionIds),
        ),
      )
      .all();

    const conflictingQuestionIds = new Set(existingTargetCheckRows.map((r) => r.questionId));

    const conflictingIds = sourceCheckRows
      .filter((r) => conflictingQuestionIds.has(r.questionId))
      .map((r) => r.id);
    if (conflictingIds.length > 0) {
      for (let i = 0; i < conflictingIds.length; i += 90) {
        const chunk = conflictingIds.slice(i, i + 90);
        await db
          .delete(checklistRoomMappings)
          .where(inArray(checklistRoomMappings.id, chunk))
          .run();
      }
    }

    const safeIds = sourceCheckRows
      .filter((r) => !conflictingQuestionIds.has(r.questionId))
      .map((r) => r.id);
    if (safeIds.length > 0) {
      for (let i = 0; i < safeIds.length; i += 90) {
        const chunk = safeIds.slice(i, i + 90);
        await db
          .update(checklistRoomMappings)
          .set({ roomId: targetId })
          .where(inArray(checklistRoomMappings.id, chunk))
          .run();
      }
    }
    rowsRepointed["checklist_room_mappings"] = safeIds.length;
  }

  // ------------------------------------------------------------------
  // 4. Delete the source room record
  //    At this point all FK references have been repointed or removed.
  //    SQLite's foreign-key cascade / restrict logic has been pre-empted
  //    by our explicit repointing, so no FK violation should occur.
  // ------------------------------------------------------------------
  await db.delete(rooms).where(eq(rooms.id, sourceId)).run();

  return {
    sourceId,
    targetId,
    rowsRepointed,
    sourceDeleted: true,
  };
}

/**
 * Move a set of listing images (images.room_id) to a target room.
 *
 * For inspirational images that should move, use inspirational_image_rooms
 * mappings directly (the API uses PUT /api/images/:id with roomIds for that).
 * This function only updates images.room_id — it is correct for listing-photo
 * reassignment (which is always a single-room assignment).
 *
 * Idempotent: images already on targetRoomId are skipped.
 *
 * @param db          Drizzle DB instance.
 * @param imageIds    Array of images.id (UUID strings) to reassign.
 * @param targetRoom  Target room id or code.
 */
export async function reassignImages(
  db: DB,
  imageIds: string[],
  targetRoom: number | string,
): Promise<ReassignImagesResult> {
  if (imageIds.length === 0) {
    return { imageIds: [], targetRoomId: -1, rowsUpdated: 0 };
  }

  const target = await resolveRoom(db, targetRoom);

  // Batch in chunks of 90 to stay within D1's statement size limits.
  for (let i = 0; i < imageIds.length; i += 90) {
    const chunk = imageIds.slice(i, i + 90);
    await db
      .update(images)
      .set({ roomId: target.id })
      .where(
        and(
          inArray(images.id, chunk),
          not(eq(images.roomId, target.id)), // skip rows already on target
        ),
      )
      .run();
  }

  return {
    imageIds,
    targetRoomId: target.id,
    rowsUpdated: imageIds.length,
  };
}

/**
 * Add inspirational image → room mappings for a set of image IDs.
 *
 * Uses INSERT OR IGNORE semantics (onConflictDoNothing) so this is safe
 * to call multiple times without creating duplicate rows.
 *
 * @param db         Drizzle DB instance.
 * @param imageIds   Array of images.id (UUID strings).
 * @param targetRoom Target room id or code to add them to.
 */
export async function addInspirationToRoom(
  db: DB,
  imageIds: string[],
  targetRoom: number | string,
): Promise<void> {
  if (imageIds.length === 0) return;

  const target = await resolveRoom(db, targetRoom);

  for (const imageId of imageIds) {
    await db
      .insert(inspirationalImageRooms)
      .values({ imageId, roomId: target.id })
      .onConflictDoNothing()
      .run();
  }
}

/**
 * Remove inspirational image → room mappings (unmap only — does not delete
 * the image record or the Cloudflare Images asset).
 *
 * Idempotent: if the mapping does not exist, the DELETE is a no-op.
 *
 * @param db         Drizzle DB instance.
 * @param imageIds   Image IDs to unmap.
 * @param fromRoom   Room id or code to unmap them from.
 */
export async function removeInspirationFromRoom(
  db: DB,
  imageIds: string[],
  fromRoom: number | string,
): Promise<void> {
  if (imageIds.length === 0) return;

  const source = await resolveRoom(db, fromRoom);

  for (let i = 0; i < imageIds.length; i += 90) {
    const chunk = imageIds.slice(i, i + 90);
    await db
      .delete(inspirationalImageRooms)
      .where(
        and(
          inArray(inspirationalImageRooms.imageId, chunk),
          eq(inspirationalImageRooms.roomId, source.id),
        ),
      )
      .run();
  }
}

/**
 * Delete a room record.
 *
 * IMPORTANT: this function only deletes the rooms row.  All FK-referencing
 * child rows must be cleared first (either repointed via mergeRooms or
 * individually deleted).  Call this only when you are certain the room has
 * no surviving FK references, otherwise SQLite will raise a constraint error.
 *
 * Idempotent: if the room does not exist, returns early without error.
 *
 * @param db         Drizzle DB instance.
 * @param codeOrId   Room code or numeric id.
 */
export async function deleteRoom(db: DB, codeOrId: string | number): Promise<void> {
  let row: typeof rooms.$inferSelect | undefined;
  try {
    row = await resolveRoom(db, codeOrId);
  } catch {
    return; // Already gone — idempotent.
  }

  await db.delete(rooms).where(eq(rooms.id, row.id)).run();
}

/**
 * Hard-delete an image from D1 only (does NOT touch Cloudflare Images API).
 *
 * This helper is for the data-fix script, which calls the CF Images delete
 * separately (via the Worker API route) or is used in contexts where the
 * CF asset is already gone or managed externally.
 *
 * Removes the images row and all dependent rows:
 *   - inspirational_image_rooms (cascade)
 *   - image_upload_staging is left in place (staging row is harmless)
 *
 * @param db      Drizzle DB instance.
 * @param imageId UUID of the images record.
 */
export async function hardDeleteImageFromD1(db: DB, imageId: string): Promise<void> {
  // D1 FK cascade isn't guaranteed to fire unless PRAGMA foreign_keys=ON.
  // Manually delete child rows first to be safe.
  await db
    .delete(inspirationalImageRooms)
    .where(eq(inspirationalImageRooms.imageId, imageId))
    .run();
  await db
    .delete(listingPhotos)
    .where(eq(listingPhotos.imageId, imageId))
    .run();
  await db.delete(images).where(eq(images.id, imageId)).run();
}
