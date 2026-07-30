import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import {
  budgetTrackerItemRooms,
  budgetTrackerItems,
  estimateCompanies,
  estimateRevisions,
  estimateRoomMappings,
  estimateStatuses,
  estimates,
  floors,
  images,
  inspirationalImageRooms,
  remodelScenarios,
  roomActionItems,
  roomAiSummaries,
  rooms,
  scenarioRoomPlans,
  supportingDocumentRoomMappings,
  supportingDocumentVisionNodeMappings,
  supportingDocuments,
  visionNodeImageMappings,
  visionNodeRoomMappings,
  visionPlanNodes,
} from "@backend/db";
import { transcribeAudioBase64 } from "@backend/services/estimate-intake";
import { ensureHomeCatalogSeed, getHomeCatalog } from "@backend/services/home-catalog";
import { generateRoomSummary } from "@backend/services/room-summary";
import { isRequestAuthenticated } from "@backend/utils/access";

const roomsRouter = new Hono<{ Bindings: Env }>();

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function parseStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry).trim()).filter(Boolean);
      }
    } catch {
      return trimmed
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function formatRoomDimensions(
  room: Pick<
    typeof rooms.$inferSelect,
    "lengthFeet" | "lengthInches" | "widthFeet" | "widthInches"
  >,
): string | null {
  const lengthSet =
    typeof room.lengthFeet === "number" || typeof room.lengthInches === "number";
  const widthSet =
    typeof room.widthFeet === "number" || typeof room.widthInches === "number";
  if (!lengthSet && !widthSet) return null;

  const formatSide = (feet: number | null, inches: number | null) => {
    const feetValue = typeof feet === "number" ? feet : 0;
    const inchesValue = typeof inches === "number" ? inches : 0;
    return `${feetValue}'${inchesValue}"`;
  };

  if (lengthSet && widthSet) {
    return `${formatSide(room.lengthFeet, room.lengthInches)} x ${formatSide(room.widthFeet, room.widthInches)}`;
  }
  if (lengthSet) {
    return formatSide(room.lengthFeet, room.lengthInches);
  }
  return formatSide(room.widthFeet, room.widthInches);
}

async function ensureAccess(c: Parameters<typeof roomsRouter.get>[1]) {
  const authenticated = await isRequestAuthenticated(c.req.raw, c.env);
  if (!authenticated) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return null;
}

/**
 * Loads full room detail, enforcing:
 *   - C1: is_active=true (404 for inactive or unknown rooms)
 *   - C3: hero/representative must be a listing photo only
 *   - Inspiration split into three typed buckets:
 *       inspirationDirect  — scope='room' images mapped via inspirational_image_rooms
 *       inspirationLevel   — scope='level' images where scope_floor_id = this room's floor
 *       inspirationHome    — scope='home' images (global)
 */
async function loadRoomDetail(env: Env, roomCode: string) {
  await ensureHomeCatalogSeed(env);
  const db = drizzle(env.DB);
  const catalog = await getHomeCatalog(env);
  const catalogRoom = catalog.floors
    .flatMap((floor) =>
      floor.rooms.map((room) => ({
        ...room,
        floorKey: floor.key,
        floorName: floor.name,
      })),
    )
    .find((room) => room.roomCode === roomCode);

  if (!catalogRoom) {
    return null;
  }

  // C1: only resolve is_active=true rooms
  const roomRecord = await db
    .select()
    .from(rooms)
    .where(and(eq(rooms.id, catalogRoom.id), eq(rooms.isActive, true)))
    .get();
  if (!roomRecord) {
    return null;
  }

  // Resolve the canonical floor record so we have a stable floor_id for level-scope queries.
  // rooms.floorId is an integer FK to floors.id.
  const floorRecord = await db
    .select()
    .from(floors)
    .where(eq(floors.id, roomRecord.floorId))
    .get();

  const roomFloorId: number | null = floorRecord?.id ?? null;

  const [
    listingImages,
    inspirationalMappings,
    actionItems,
    summaryRow,
    scenarioPlanRows,
    documentMappings,
    nodeMappings,
    budgetMappings,
    estimateMappings,
  ] = await Promise.all([
    db
      .select()
      .from(images)
      .where(and(eq(images.photoCategory, "listing"), eq(images.roomId, roomRecord.id)))
      .orderBy(desc(images.datetimeCreated))
      .all(),
    // Only room-scoped inspiration uses the join table
    db
      .select()
      .from(inspirationalImageRooms)
      .where(eq(inspirationalImageRooms.roomId, roomRecord.id))
      .all(),
    db
      .select()
      .from(roomActionItems)
      .where(eq(roomActionItems.roomId, roomRecord.id))
      .orderBy(asc(roomActionItems.priority), desc(roomActionItems.datetimeUpdated))
      .all(),
    db
      .select()
      .from(roomAiSummaries)
      .where(eq(roomAiSummaries.roomId, roomRecord.id))
      .get(),
    db
      .select()
      .from(scenarioRoomPlans)
      .where(eq(scenarioRoomPlans.roomId, roomRecord.id))
      .orderBy(desc(scenarioRoomPlans.datetimeUpdated))
      .all(),
    db
      .select()
      .from(supportingDocumentRoomMappings)
      .where(eq(supportingDocumentRoomMappings.roomId, roomRecord.id))
      .all(),
    db
      .select()
      .from(visionNodeRoomMappings)
      .where(eq(visionNodeRoomMappings.roomId, roomRecord.id))
      .all(),
    db
      .select()
      .from(budgetTrackerItemRooms)
      .where(eq(budgetTrackerItemRooms.roomId, roomRecord.id))
      .all(),
    db
      .select()
      .from(estimateRoomMappings)
      .where(eq(estimateRoomMappings.roomId, roomRecord.id))
      .all(),
  ]);

  const inspirationImageIds = Array.from(
    new Set(inspirationalMappings.map((mapping) => mapping.imageId)),
  );
  const documentIds = Array.from(
    new Set(documentMappings.map((mapping) => mapping.supportingDocumentId)),
  );
  const nodeIds = Array.from(new Set(nodeMappings.map((mapping) => mapping.visionNodeId)));
  const budgetItemIds = Array.from(
    new Set(budgetMappings.map((mapping) => mapping.budgetTrackerItemId)),
  );
  const estimateRevisionIds = Array.from(
    new Set(estimateMappings.map((mapping) => mapping.estimateRevisionId)),
  );
  const scenarioIds = Array.from(new Set(scenarioPlanRows.map((plan) => plan.scenarioId)));

  const [
    // room-scoped (direct) inspiration images via inspirational_image_rooms
    inspirationDirectImages,
    // level-scoped inspiration: scope='level' AND scope_floor_id = this room's floor
    inspirationLevelImages,
    // home-scoped inspiration: scope='home' (applies to all rooms)
    inspirationHomeImages,
    documentRows,
    nodeRows,
    nodeImageRows,
    nodeDocumentRows,
    budgetRows,
    estimateRevisionRows,
    scenarioRows,
  ] = await Promise.all([
    inspirationImageIds.length > 0
      ? db
          .select()
          .from(images)
          .where(
            and(
              inArray(images.id, inspirationImageIds),
              eq(images.inspirationScope, "room"),
            ),
          )
          .orderBy(desc(images.datetimeCreated))
          .all()
      : Promise.resolve([]),
    // Level-scoped: no join table row needed; query by scope + floor
    roomFloorId !== null
      ? db
          .select()
          .from(images)
          .where(
            and(
              eq(images.inspirationScope, "level"),
              eq(images.scopeFloorId, roomFloorId),
            ),
          )
          .orderBy(desc(images.datetimeCreated))
          .all()
      : Promise.resolve([]),
    // Home-scoped: no floor filter
    db
      .select()
      .from(images)
      .where(eq(images.inspirationScope, "home"))
      .orderBy(desc(images.datetimeCreated))
      .all(),
    documentIds.length > 0
      ? db
          .select()
          .from(supportingDocuments)
          .where(inArray(supportingDocuments.id, documentIds))
          .orderBy(desc(supportingDocuments.datetimeUpdated))
          .all()
      : Promise.resolve([]),
    nodeIds.length > 0
      ? db
          .select()
          .from(visionPlanNodes)
          .where(inArray(visionPlanNodes.id, nodeIds))
          .orderBy(asc(visionPlanNodes.sortOrder), asc(visionPlanNodes.datetimeCreated))
          .all()
      : Promise.resolve([]),
    nodeIds.length > 0
      ? db
          .select()
          .from(visionNodeImageMappings)
          .where(inArray(visionNodeImageMappings.visionNodeId, nodeIds))
          .all()
      : Promise.resolve([]),
    nodeIds.length > 0
      ? db
          .select()
          .from(supportingDocumentVisionNodeMappings)
          .where(inArray(supportingDocumentVisionNodeMappings.visionNodeId, nodeIds))
          .all()
      : Promise.resolve([]),
    budgetItemIds.length > 0
      ? db
          .select()
          .from(budgetTrackerItems)
          .where(inArray(budgetTrackerItems.id, budgetItemIds))
          .orderBy(desc(budgetTrackerItems.datetimeUpdated))
          .all()
      : Promise.resolve([]),
    estimateRevisionIds.length > 0
      ? db
          .select()
          .from(estimateRevisions)
          .where(inArray(estimateRevisions.id, estimateRevisionIds))
          .orderBy(desc(estimateRevisions.datetimeUpdated))
          .all()
      : Promise.resolve([]),
    scenarioIds.length > 0
      ? db
          .select()
          .from(remodelScenarios)
          .where(inArray(remodelScenarios.id, scenarioIds))
          .all()
      : Promise.resolve([]),
  ]);

  const thumbnailImageIds = Array.from(
    new Set(
      nodeRows
        .map((node) => node.thumbnailImageId)
        .filter((value): value is string => typeof value === "string" && value.length > 0),
    ),
  );
  const imageRefIds = Array.from(new Set(nodeImageRows.map((row) => row.imageId)));
  const estimateIds = Array.from(new Set(estimateRevisionRows.map((revision) => revision.estimateId)));
  const statusIds = Array.from(
    new Set(
      estimateRevisionRows
        .map((revision) => revision.estimateStatusId)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    ),
  );

  const [nodeImageRecords, estimateRows, statusRows, childNodeRows] = await Promise.all([
    [...thumbnailImageIds, ...imageRefIds].length > 0
      ? db
          .select()
          .from(images)
          .where(inArray(images.id, Array.from(new Set([...thumbnailImageIds, ...imageRefIds]))))
          .all()
      : Promise.resolve([]),
    estimateIds.length > 0
      ? db.select().from(estimates).where(inArray(estimates.id, estimateIds)).all()
      : Promise.resolve([]),
    statusIds.length > 0
      ? db.select().from(estimateStatuses).where(inArray(estimateStatuses.id, statusIds)).all()
      : Promise.resolve([]),
    nodeIds.length > 0
      ? db
          .select()
          .from(visionPlanNodes)
          .where(inArray(visionPlanNodes.parentId, nodeIds))
          .all()
      : Promise.resolve([]),
  ]);
  const companyIds = Array.from(
    new Set(
      estimateRows
        .map((estimate) => estimate.estimateCompanyId)
        .filter((value): value is number => typeof value === "number" && Number.isFinite(value)),
    ),
  );
  const companyRows =
    companyIds.length > 0
      ? await db
          .select()
          .from(estimateCompanies)
          .where(inArray(estimateCompanies.id, companyIds))
          .all()
      : [];

  const scenarioById = new Map(scenarioRows.map((scenario) => [scenario.id, scenario]));
  const nodeImageById = new Map(nodeImageRecords.map((image) => [image.id, image]));
  const estimateById = new Map(estimateRows.map((estimate) => [estimate.id, estimate]));
  const companyById = new Map(companyRows.map((company) => [company.id, company]));
  const statusById = new Map(statusRows.map((status) => [status.id, status]));
  const childCountByParentId = new Map<string, number>();
  for (const node of childNodeRows) {
    if (!node.parentId) continue;
    childCountByParentId.set(node.parentId, (childCountByParentId.get(node.parentId) || 0) + 1);
  }

  const activeBudgetRows = budgetRows.filter((row) => row.isActive);
  const totalBudgetLowCents = activeBudgetRows.reduce(
    (sum, item) => sum + (item.estimatedLowCents || 0),
    0,
  );
  const totalBudgetHighCents = activeBudgetRows.reduce(
    (sum, item) => sum + (item.estimatedHighCents || 0),
    0,
  );

  const estimateCards = estimateRevisionRows.map((revision) => {
    const estimate = estimateById.get(revision.estimateId) || null;
    const company =
      estimate?.estimateCompanyId && companyById.has(estimate.estimateCompanyId)
        ? companyById.get(estimate.estimateCompanyId) || null
        : null;
    const status =
      revision.estimateStatusId && statusById.has(revision.estimateStatusId)
        ? statusById.get(revision.estimateStatusId) || null
        : null;
    return {
      ...revision,
      estimateId: revision.estimateId,
      companyName: company?.name || null,
      statusName: status?.name || null,
      scenarioId: estimate?.scenarioId || null,
    };
  });

  /**
   * C3: hero/representative must be a listing photo only.
   * Fallback chain: representativeImageId (if listing) → first listing image → null.
   * An inspiration photo must NEVER be a hero candidate.
   */
  const representativeImage =
    (summaryRow?.representativeImageId
      ? listingImages.find((image) => image.id === summaryRow.representativeImageId) || null
      : null) || listingImages[0] || null;

  /**
   * Map each inspiration image to include inspirationCategory in the payload.
   * This is the field the /review categorization endpoints write to.
   */
  const mapInspirationImage = (img: typeof images.$inferSelect) => ({
    ...img,
    inspirationCategory: img.inspirationCategory ?? null,
  });

  return {
    room: {
      ...roomRecord,
      displayName: catalogRoom.displayName,
      floorKey: catalogRoom.floorKey,
      floorName: catalogRoom.floorName,
      floorId: roomFloorId,
      dimensionLabel: formatRoomDimensions(roomRecord),
      // 0006 P1: prefer the explicit area override (computed in getHomeCatalog →
      // computeRoomSqft) so irregular rooms (e.g. the L-shaped foyer) report true area.
      sqft: catalogRoom.sqft,
    },
    summary: summaryRow
      ? {
          ...summaryRow,
          summaryObject: parseJsonObject(summaryRow.summaryJson),
        }
      : null,
    representativeImage,
    listingImages,
    /**
     * Three inspiration buckets (replaces flat inspirationalImages):
     *   inspirationDirect  — scope='room' images explicitly mapped to this room via
     *                        inspirational_image_rooms. Show prominently.
     *   inspirationLevel   — scope='level' images applied to this room's whole floor.
     *                        Render in collapsed "Applies to whole level" appendix.
     *   inspirationHome    — scope='home' images applied to the entire home.
     *                        Render in collapsed "Applies to whole home" appendix.
     * Each image includes `inspirationCategory` (nullable string).
     */
    inspirationDirect: inspirationDirectImages.map(mapInspirationImage),
    inspirationLevel: inspirationLevelImages.map(mapInspirationImage),
    inspirationHome: inspirationHomeImages.map(mapInspirationImage),
    /** Legacy flat array — kept for backward compat; equals inspirationDirect only. */
    inspirationalImages: inspirationDirectImages.map(mapInspirationImage),
    supportingDocuments: documentRows.map((document) => ({
      ...document,
      tags: parseStringArray(document.tagsJson),
    })),
    actionItems,
    scenarioPlans: scenarioPlanRows.map((plan) => ({
      ...plan,
      scenarioName: scenarioById.get(plan.scenarioId)?.name || "Scenario",
    })),
    budget: {
      items: activeBudgetRows,
      totalBudgetLowCents,
      totalBudgetHighCents,
    },
    estimates: estimateCards,
    visionNodes: nodeRows.map((node) => {
      const thumbnailImage =
        (node.thumbnailImageId ? nodeImageById.get(node.thumbnailImageId) || null : null) ||
        (nodeImageRows
          .filter((mapping) => mapping.visionNodeId === node.id)
          .map((mapping) => nodeImageById.get(mapping.imageId) || null)
          .find(Boolean) || null);
      const supportingDocumentIds = nodeDocumentRows
        .filter((mapping) => mapping.visionNodeId === node.id)
        .map((mapping) => mapping.supportingDocumentId);
      const imageRefs = nodeImageRows
        .filter((mapping) => mapping.visionNodeId === node.id)
        .map((mapping) => ({
          imageId: mapping.imageId,
          relationType: mapping.relationType,
          image: nodeImageById.get(mapping.imageId) || null,
        }));

      return {
        ...node,
        childCount: childCountByParentId.get(node.id) || 0,
        supportingDocumentIds,
        imageRefs,
        thumbnailImage,
      };
    }),
  };
}

async function upsertRoomSummary(
  db: ReturnType<typeof drizzle>,
  roomId: number,
  updates: {
    representativeImageId?: string | null;
    summaryMarkdown?: string | null;
    summaryJson?: string | null;
    lastUserPrompt?: string | null;
    lastVoiceTranscript?: string | null;
    model?: string | null;
    datetimeGenerated?: Date | null;
  },
) {
  const now = new Date();
  const nextValues: Partial<typeof roomAiSummaries.$inferInsert> = {
    datetimeUpdated: now,
  };
  const insertValues: typeof roomAiSummaries.$inferInsert = {
    roomId,
    representativeImageId: null,
    summaryMarkdown: null,
    summaryJson: null,
    lastUserPrompt: null,
    lastVoiceTranscript: null,
    model: null,
    datetimeCreated: now,
    datetimeUpdated: now,
    datetimeGenerated: null,
  };

  if (updates.representativeImageId !== undefined) {
    nextValues.representativeImageId = updates.representativeImageId;
    insertValues.representativeImageId = updates.representativeImageId;
  }
  if (updates.summaryMarkdown !== undefined) {
    nextValues.summaryMarkdown = updates.summaryMarkdown;
    insertValues.summaryMarkdown = updates.summaryMarkdown;
  }
  if (updates.summaryJson !== undefined) {
    nextValues.summaryJson = updates.summaryJson;
    insertValues.summaryJson = updates.summaryJson;
  }
  if (updates.lastUserPrompt !== undefined) {
    nextValues.lastUserPrompt = updates.lastUserPrompt;
    insertValues.lastUserPrompt = updates.lastUserPrompt;
  }
  if (updates.lastVoiceTranscript !== undefined) {
    nextValues.lastVoiceTranscript = updates.lastVoiceTranscript;
    insertValues.lastVoiceTranscript = updates.lastVoiceTranscript;
  }
  if (updates.model !== undefined) {
    nextValues.model = updates.model;
    insertValues.model = updates.model;
  }
  if (updates.datetimeGenerated !== undefined) {
    nextValues.datetimeGenerated = updates.datetimeGenerated;
    insertValues.datetimeGenerated = updates.datetimeGenerated;
  }

  await db
    .insert(roomAiSummaries)
    .values(insertValues)
    .onConflictDoUpdate({
      target: roomAiSummaries.roomId,
      set: nextValues,
    })
    .run();

  return db
    .select()
    .from(roomAiSummaries)
    .where(eq(roomAiSummaries.roomId, roomId))
    .get();
}

/**
 * GET /catalog
 *
 * Returns the full home catalog: all floors with their rooms, enriched with
 * per-room aggregate stats so the floor-plan dot hover-card (T2.1, Phase 2)
 * needs no additional fetch.
 *
 * Response shape (stable contract for cf-frontend-engineer):
 * {
 *   success: true,
 *   floors: [
 *     {
 *       id: number,
 *       key: string,          // e.g. "lower_level" | "upper_level" | "outside"
 *       name: string,
 *       levelOrder: number,
 *       rooms: [
 *         {
 *           id: number,
 *           roomCode: string,     // stable kebab-case slug
 *           roomName: string,     // raw DB name
 *           displayName: string,  // disambiguated display name
 *           floorplanFloorKey: string | null,  // canvas floor key
 *           floorplanXPct: number | null,      // 0–100; null = no dot
 *           floorplanYPct: number | null,      // 0–100; null = no dot
 *           listingCount: number,     // photo_category='listing' images for this room
 *           inspirationCount: number, // inspirational_image_rooms entries for this room
 *           heroImageUrl: string | null,
 *           dimensions: string | null, // e.g. "15'0\" x 24'10\""
 *           sqft: number | null,
 *           // … all other rooms columns (asIsUse, isLivingSpace, notes, dims, etc.)
 *         }
 *       ]
 *     }
 *   ],
 *   rooms: Array  // flat backward-compatible array (all columns, no enrichment)
 * }
 *
 * Backward compatibility: the flat `rooms` array at the top level is preserved
 * for any caller that was iterating it directly (e.g. RoomViewApp room lookups).
 * New callers should consume `floors[].rooms` which carries all the T2.1 fields.
 */
roomsRouter.get("/catalog", async (c) => {
  try {
    await ensureHomeCatalogSeed(c.env);
    const catalog = await getHomeCatalog(c.env);
    return c.json({
      success: true,
      floors: catalog.floors,
      // Backward-compatible flat rooms array (columns only, no enrichment).
      rooms: catalog.rooms,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load room catalog",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// Public read: the floor plan links every room dot here, and the floor plan +
// room catalog are already public. Writes below stay gated; per-visitor editing
// affordances gate on GET /api/access/status in the client, not on this read.
roomsRouter.get("/code/:roomCode/detail", async (c) => {
  try {
    const roomCode = c.req.param("roomCode");
    const detail = await loadRoomDetail(c.env, roomCode);
    if (!detail) {
      return c.json({ error: "Room not found" }, 404);
    }

    // Public callers get the full product payload (rooms, photos, budget,
    // estimates, options, docs), but NOT the homeowner's raw AI-authoring
    // metadata: `lastUserPrompt`/`lastVoiceTranscript` are private dictation
    // that the client only ever renders inside the authed editor. Null them
    // for unauthenticated callers so they never travel over the public wire.
    const authenticated = await isRequestAuthenticated(c.req.raw, c.env);
    const summary =
      detail.summary && !authenticated
        ? { ...detail.summary, lastUserPrompt: null, lastVoiceTranscript: null }
        : detail.summary;

    return c.json({
      success: true,
      ...detail,
      summary,
      roomStats: {
        listingPhotoCount: detail.listingImages.length,
        // Direct inspiration (room-scoped) count — used for the room badge
        inspirationPhotoCount: detail.inspirationDirect.length,
        // Broad-scope counts (shown separately, collapsed by default)
        inspirationLevelCount: detail.inspirationLevel.length,
        inspirationHomeCount: detail.inspirationHome.length,
        supportingDocumentCount: detail.supportingDocuments.length,
        actionItemCount: detail.actionItems.length,
        visionNodeCount: detail.visionNodes.length,
        estimateCount: detail.estimates.length,
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load room detail",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

roomsRouter.patch("/code/:roomCode/profile", async (c) => {
  const accessError = await ensureAccess(c);
  if (accessError) return accessError;

  try {
    const roomCode = c.req.param("roomCode");
    const detail = await loadRoomDetail(c.env, roomCode);
    if (!detail) {
      return c.json({ error: "Room not found" }, 404);
    }

    const body = (await c.req.json()) as { representativeImageId?: string | null };
    const representativeImageId =
      typeof body.representativeImageId === "string" && body.representativeImageId.trim()
        ? body.representativeImageId.trim()
        : null;

    if (
      representativeImageId &&
      !detail.listingImages.some((image) => image.id === representativeImageId)
    ) {
      return c.json({ error: "Representative image must be one of the room listing photos" }, 400);
    }

    const db = drizzle(c.env.DB);
    const summaryRow = await upsertRoomSummary(db, detail.room.id, {
      representativeImageId,
    });

    return c.json({
      success: true,
      summary: summaryRow
        ? {
            ...summaryRow,
            summaryObject: parseJsonObject(summaryRow.summaryJson),
          }
        : null,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update room profile",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

roomsRouter.post("/code/:roomCode/summary", async (c) => {
  const accessError = await ensureAccess(c);
  if (accessError) return accessError;

  try {
    const roomCode = c.req.param("roomCode");
    const detail = await loadRoomDetail(c.env, roomCode);
    if (!detail) {
      return c.json({ error: "Room not found" }, 404);
    }

    const body = (await c.req.json()) as {
      prompt?: string;
      audioBase64?: string | null;
      representativeImageId?: string | null;
    };

    const prompt = body.prompt?.trim() || null;
    const representativeImageId =
      typeof body.representativeImageId === "string" && body.representativeImageId.trim()
        ? body.representativeImageId.trim()
        : detail.summary?.representativeImageId || null;

    if (
      representativeImageId &&
      !detail.listingImages.some((image) => image.id === representativeImageId)
    ) {
      return c.json({ error: "Representative image must be one of the room listing photos" }, 400);
    }

    const voiceTranscript =
      typeof body.audioBase64 === "string" && body.audioBase64.trim()
        ? await transcribeAudioBase64(c.env, body.audioBase64.trim())
        : null;

    const generated = await generateRoomSummary(c.env, {
      room: {
        displayName: detail.room.displayName,
        roomCode: detail.room.roomCode,
        floorName: detail.room.floorName,
        asIsUse: detail.room.asIsUse,
        dimensionLabel: detail.room.dimensionLabel,
        problemAreas: detail.room.problemAreas,
        generalNotes: detail.room.generalNotes,
        plumbingNotes: detail.room.plumbingNotes,
        electricalNotes: detail.room.electricalNotes,
        structuralNotes: detail.room.structuralNotes,
        hvacNotes: detail.room.hvacNotes,
      },
      listingImages: detail.listingImages,
      // Pass all inspiration buckets merged for summary context
      inspirationalImages: [
        ...detail.inspirationDirect,
        ...detail.inspirationLevel,
        ...detail.inspirationHome,
      ],
      supportingDocuments: detail.supportingDocuments,
      actionItems: detail.actionItems,
      scenarioPlans: detail.scenarioPlans,
      budgetItems: detail.budget.items,
      estimates: detail.estimates,
      visionNodes: detail.visionNodes,
      userPrompt: prompt,
      voiceTranscript,
    });

    const db = drizzle(c.env.DB);
    const summaryRow = await upsertRoomSummary(db, detail.room.id, {
      representativeImageId,
      summaryMarkdown: generated.summaryMarkdown,
      summaryJson: JSON.stringify(generated.summaryObject),
      lastUserPrompt: prompt,
      lastVoiceTranscript: voiceTranscript,
      model: generated.model,
      datetimeGenerated: new Date(),
    });

    return c.json({
      success: true,
      summary: summaryRow
        ? {
            ...summaryRow,
            summaryObject: parseJsonObject(summaryRow.summaryJson),
          }
        : null,
      voiceTranscript,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to regenerate room summary",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

roomsRouter.get("/scenarios", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const scenarios = await db
      .select()
      .from(remodelScenarios)
      .orderBy(asc(remodelScenarios.datetimeCreated))
      .all();

    const plans = await db
      .select()
      .from(scenarioRoomPlans)
      .orderBy(asc(scenarioRoomPlans.datetimeCreated))
      .all();

    const plansByScenario = new Map<string, typeof plans>();
    for (const plan of plans) {
      if (!plansByScenario.has(plan.scenarioId)) {
        plansByScenario.set(plan.scenarioId, []);
      }
      plansByScenario.get(plan.scenarioId)!.push(plan);
    }

    return c.json({
      success: true,
      scenarios: scenarios.map((scenario) => ({
        ...scenario,
        plans: plansByScenario.get(scenario.id) || [],
      })),
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list scenarios",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

roomsRouter.post("/scenarios", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const body = (await c.req.json()) as {
      name?: string;
      description?: string;
      budgetLowCents?: number;
      budgetHighCents?: number;
    };

    const name = body.name?.trim();
    if (!name) {
      return c.json({ error: "Scenario name is required" }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date();

    await db
      .insert(remodelScenarios)
      .values({
        id,
        name,
        description: body.description?.trim() || null,
        budgetLowCents:
          typeof body.budgetLowCents === "number" ? body.budgetLowCents : null,
        budgetHighCents:
          typeof body.budgetHighCents === "number" ? body.budgetHighCents : null,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .run();

    const created = await db
      .select()
      .from(remodelScenarios)
      .where(eq(remodelScenarios.id, id))
      .get();

    return c.json({ success: true, scenario: created }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create scenario",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

roomsRouter.post("/scenarios/:scenarioId/plans", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const scenarioId = c.req.param("scenarioId");
    const body = (await c.req.json()) as {
      roomId?: number;
      proposedUse?: string;
      stage?: string;
      estimatedCostCents?: number;
      notes?: string;
    };

    const scenario = await db
      .select()
      .from(remodelScenarios)
      .where(eq(remodelScenarios.id, scenarioId))
      .get();

    if (!scenario) {
      return c.json({ error: "Scenario not found" }, 404);
    }

    if (!body.roomId || !Number.isFinite(body.roomId)) {
      return c.json({ error: "roomId is required" }, 400);
    }

    const room = await db.select().from(rooms).where(eq(rooms.id, body.roomId)).get();
    if (!room) {
      return c.json({ error: "Room not found" }, 404);
    }

    const proposedUse = body.proposedUse?.trim();
    if (!proposedUse) {
      return c.json({ error: "proposedUse is required" }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date();

    await db
      .insert(scenarioRoomPlans)
      .values({
        id,
        scenarioId,
        roomId: room.id,
        proposedUse,
        stage: body.stage?.trim() || "considering",
        estimatedCostCents:
          typeof body.estimatedCostCents === "number"
            ? body.estimatedCostCents
            : null,
        notes: body.notes?.trim() || null,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .run();

    await db
      .update(remodelScenarios)
      .set({
        datetimeUpdated: now,
      })
      .where(eq(remodelScenarios.id, scenarioId))
      .run();

    const plan = await db
      .select()
      .from(scenarioRoomPlans)
      .where(eq(scenarioRoomPlans.id, id))
      .get();

    return c.json({ success: true, plan }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create scenario room plan",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

roomsRouter.get("/:roomId/action-items", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const roomId = Number(c.req.param("roomId"));
    if (!Number.isFinite(roomId)) {
      return c.json({ error: "Invalid room ID" }, 400);
    }

    const scenarioId = c.req.query("scenarioId");

    const room = await db.select().from(rooms).where(eq(rooms.id, roomId)).get();
    if (!room) {
      return c.json({ error: "Room not found" }, 404);
    }

    const items = scenarioId
      ? await db
          .select()
          .from(roomActionItems)
          .where(
            and(
              eq(roomActionItems.roomId, roomId),
              eq(roomActionItems.scenarioId, scenarioId),
            ),
          )
          .orderBy(asc(roomActionItems.datetimeCreated))
          .all()
      : await db
          .select()
          .from(roomActionItems)
          .where(eq(roomActionItems.roomId, roomId))
          .orderBy(asc(roomActionItems.datetimeCreated))
          .all();

    return c.json({ success: true, room, items });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list room action items",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

roomsRouter.post("/:roomId/action-items", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const roomId = Number(c.req.param("roomId"));
    if (!Number.isFinite(roomId)) {
      return c.json({ error: "Invalid room ID" }, 400);
    }

    const room = await db.select().from(rooms).where(eq(rooms.id, roomId)).get();
    if (!room) {
      return c.json({ error: "Room not found" }, 404);
    }

    const body = (await c.req.json()) as {
      scenarioId?: string;
      category?: string;
      title?: string;
      details?: string;
      status?: string;
      priority?: number;
      estimatedCostCents?: number;
    };

    const title = body.title?.trim();
    if (!title) {
      return c.json({ error: "title is required" }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date();

    await db
      .insert(roomActionItems)
      .values({
        id,
        roomId,
        scenarioId: body.scenarioId?.trim() || null,
        category: body.category?.trim() || "general",
        title,
        details: body.details?.trim() || null,
        status: body.status?.trim() || "open",
        priority:
          typeof body.priority === "number" && Number.isFinite(body.priority)
            ? body.priority
            : 2,
        estimatedCostCents:
          typeof body.estimatedCostCents === "number"
            ? body.estimatedCostCents
            : null,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .run();

    const created = await db
      .select()
      .from(roomActionItems)
      .where(eq(roomActionItems.id, id))
      .get();

    return c.json({ success: true, item: created }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to create room action item",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { roomsRouter };
