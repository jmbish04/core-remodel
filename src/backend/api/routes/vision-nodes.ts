import { asc, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import {
  images,
  remodelScenarios,
  rooms,
  supportingDocumentVisionNodeMappings,
  supportingDocuments,
  visionNodeImageMappings,
  visionNodeRoomMappings,
  visionPlanNodes,
} from "@backend/db";
import { ensureHomeCatalogSeed } from "@backend/services/home-catalog";

const visionNodesRouter = new Hono<{ Bindings: Env }>();

function parseStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        return parseStringArray(JSON.parse(trimmed) as unknown);
      } catch {
        return [];
      }
    }
    return trimmed
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function parseNumberArray(value: unknown): number[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((entry) => Number(entry))
      .filter((entry) => Number.isFinite(entry))
      .map((entry) => Math.trunc(entry));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        return parseNumberArray(JSON.parse(trimmed) as unknown);
      } catch {
        return [];
      }
    }
    return trimmed
      .split(",")
      .map((entry) => Number(entry.trim()))
      .filter((entry) => Number.isFinite(entry))
      .map((entry) => Math.trunc(entry));
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return [Math.trunc(value)];
  }
  return [];
}

function normalizeNodeType(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) return "option";
  return raw;
}

function normalizeNodeStatus(value: unknown): string {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!raw) return "considering";
  return raw;
}

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

async function replaceNodeMappings(
  db: ReturnType<typeof drizzle>,
  nodeId: string,
  params: {
    roomIds?: number[];
    imageRefs?: Array<{ imageId: string; relationType: string }>;
    supportingDocumentIds?: string[];
  },
) {
  const roomIds = params.roomIds || [];
  const imageRefs = params.imageRefs || [];
  const supportingDocumentIds = params.supportingDocumentIds || [];

  await Promise.all([
    db
      .delete(visionNodeRoomMappings)
      .where(eq(visionNodeRoomMappings.visionNodeId, nodeId))
      .run(),
    db
      .delete(visionNodeImageMappings)
      .where(eq(visionNodeImageMappings.visionNodeId, nodeId))
      .run(),
    db
      .delete(supportingDocumentVisionNodeMappings)
      .where(eq(supportingDocumentVisionNodeMappings.visionNodeId, nodeId))
      .run(),
  ]);

  if (roomIds.length > 0) {
    await db
      .insert(visionNodeRoomMappings)
      .values(
        roomIds.map((roomId) => ({
          visionNodeId: nodeId,
          roomId,
        })),
      )
      .onConflictDoNothing()
      .run();
  }

  if (imageRefs.length > 0) {
    await db
      .insert(visionNodeImageMappings)
      .values(
        imageRefs.map((ref) => ({
          visionNodeId: nodeId,
          imageId: ref.imageId,
          relationType: ref.relationType,
        })),
      )
      .onConflictDoNothing()
      .run();
  }

  if (supportingDocumentIds.length > 0) {
    await db
      .insert(supportingDocumentVisionNodeMappings)
      .values(
        supportingDocumentIds.map((supportingDocumentId) => ({
          supportingDocumentId,
          visionNodeId: nodeId,
        })),
      )
      .onConflictDoNothing()
      .run();
  }
}

async function buildVisionNodePayload(
  db: ReturnType<typeof drizzle>,
  scenarioId?: string,
) {
  const nodeRows = scenarioId
    ? await db
        .select()
        .from(visionPlanNodes)
        .where(eq(visionPlanNodes.scenarioId, scenarioId))
        .orderBy(asc(visionPlanNodes.sortOrder), asc(visionPlanNodes.datetimeCreated))
        .all()
    : await db
        .select()
        .from(visionPlanNodes)
        .orderBy(asc(visionPlanNodes.sortOrder), asc(visionPlanNodes.datetimeCreated))
        .all();

  const nodeIds = nodeRows.map((row) => row.id);
  if (nodeIds.length === 0) {
    return {
      nodes: [],
      tree: [],
    };
  }

  const [roomMappings, imageMappings, documentMappings] = await Promise.all([
    db
      .select()
      .from(visionNodeRoomMappings)
      .where(inArray(visionNodeRoomMappings.visionNodeId, nodeIds))
      .all(),
    db
      .select()
      .from(visionNodeImageMappings)
      .where(inArray(visionNodeImageMappings.visionNodeId, nodeIds))
      .all(),
    db
      .select()
      .from(supportingDocumentVisionNodeMappings)
      .where(inArray(supportingDocumentVisionNodeMappings.visionNodeId, nodeIds))
      .all(),
  ]);

  const roomIds = Array.from(new Set(roomMappings.map((row) => row.roomId)));
  const imageIds = Array.from(new Set(imageMappings.map((row) => row.imageId)));
  const documentIds = Array.from(
    new Set(documentMappings.map((row) => row.supportingDocumentId)),
  );

  const [roomRows, imageRows, documentRows] = await Promise.all([
    roomIds.length > 0 ? db.select().from(rooms).where(inArray(rooms.id, roomIds)).all() : [],
    imageIds.length > 0 ? db.select().from(images).where(inArray(images.id, imageIds)).all() : [],
    documentIds.length > 0
      ? db
          .select()
          .from(supportingDocuments)
          .where(inArray(supportingDocuments.id, documentIds))
          .all()
      : [],
  ]);

  const roomById = new Map(roomRows.map((row) => [row.id, row]));
  const imageById = new Map(imageRows.map((row) => [row.id, row]));
  const documentById = new Map(documentRows.map((row) => [row.id, row]));

  const roomIdsByNodeId = new Map<string, number[]>();
  const imageRefsByNodeId = new Map<
    string,
    Array<{ imageId: string; relationType: string }>
  >();
  const documentIdsByNodeId = new Map<string, string[]>();

  for (const row of roomMappings) {
    const next = roomIdsByNodeId.get(row.visionNodeId) || [];
    if (!next.includes(row.roomId)) next.push(row.roomId);
    roomIdsByNodeId.set(row.visionNodeId, next);
  }
  for (const row of imageMappings) {
    const next = imageRefsByNodeId.get(row.visionNodeId) || [];
    if (!next.some((entry) => entry.imageId === row.imageId && entry.relationType === row.relationType)) {
      next.push({
        imageId: row.imageId,
        relationType: row.relationType,
      });
    }
    imageRefsByNodeId.set(row.visionNodeId, next);
  }
  for (const row of documentMappings) {
    const next = documentIdsByNodeId.get(row.visionNodeId) || [];
    if (!next.includes(row.supportingDocumentId)) next.push(row.supportingDocumentId);
    documentIdsByNodeId.set(row.visionNodeId, next);
  }

  const nodePayload = nodeRows.map((node) => {
    const mappedRoomIds = roomIdsByNodeId.get(node.id) || [];
    const mappedImageRefs = imageRefsByNodeId.get(node.id) || [];
    const mappedDocumentIds = documentIdsByNodeId.get(node.id) || [];
    const roomLabels = mappedRoomIds
      .map((roomId) => roomById.get(roomId)?.roomName)
      .filter((value): value is string => typeof value === "string");
    const imageItems = mappedImageRefs
      .map((ref) => ({
        ...ref,
        image: imageById.get(ref.imageId) || null,
      }))
      .filter((entry) => entry.image !== null);
    const documents = mappedDocumentIds
      .map((id) => documentById.get(id))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    return {
      ...node,
      roomIds: mappedRoomIds,
      roomLabels,
      imageRefs: imageItems,
      supportingDocumentIds: mappedDocumentIds,
      supportingDocuments: documents,
    };
  });

  const childrenByParentId = new Map<string | null, typeof nodePayload>();
  for (const node of nodePayload) {
    const parentId = node.parentId || null;
    if (!childrenByParentId.has(parentId)) {
      childrenByParentId.set(parentId, []);
    }
    childrenByParentId.get(parentId)!.push(node);
  }
  for (const group of childrenByParentId.values()) {
    group.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return new Date(a.datetimeCreated).getTime() - new Date(b.datetimeCreated).getTime();
    });
  }

  type NodeWithChildren = (typeof nodePayload)[number] & { children: NodeWithChildren[] };
  const buildTree = (parentId: string | null): NodeWithChildren[] => {
    const children = childrenByParentId.get(parentId) || [];
    return children.map((node) => ({
      ...node,
      children: buildTree(node.id),
    }));
  };

  return {
    nodes: nodePayload,
    tree: buildTree(null),
  };
}

visionNodesRouter.get("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const scenarioId = c.req.query("scenarioId")?.trim() || undefined;
    const payload = await buildVisionNodePayload(db, scenarioId);
    return c.json({
      success: true,
      ...payload,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list vision nodes",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

visionNodesRouter.post("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    await ensureHomeCatalogSeed(c.env);
    const body = (await c.req.json()) as Record<string, unknown>;

    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return c.json({ error: "title is required" }, 400);
    }

    const parentId =
      typeof body.parentId === "string" && body.parentId.trim().length > 0
        ? body.parentId.trim()
        : null;
    const scenarioId =
      typeof body.scenarioId === "string" && body.scenarioId.trim().length > 0
        ? body.scenarioId.trim()
        : null;

    if (parentId) {
      const parent = await db
        .select()
        .from(visionPlanNodes)
        .where(eq(visionPlanNodes.id, parentId))
        .get();
      if (!parent) {
        return c.json({ error: "parentId does not match an existing node" }, 404);
      }
    }

    if (scenarioId) {
      const scenario = await db
        .select()
        .from(remodelScenarios)
        .where(eq(remodelScenarios.id, scenarioId))
        .get();
      if (!scenario) {
        return c.json({ error: "scenarioId does not match an existing scenario" }, 404);
      }
    }

    const roomIds = parseNumberArray(body.roomIds);
    const supportingDocumentIds = parseStringArray(body.supportingDocumentIds);
    const imageRefsRaw = Array.isArray(body.imageRefs) ? body.imageRefs : [];
    const imageRefs = imageRefsRaw
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const imageId =
          typeof (entry as Record<string, unknown>).imageId === "string"
            ? ((entry as Record<string, unknown>).imageId as string).trim()
            : "";
        if (!imageId) return null;
        const relationType =
          typeof (entry as Record<string, unknown>).relationType === "string"
            ? ((entry as Record<string, unknown>).relationType as string).trim().toLowerCase()
            : "reference";
        return {
          imageId,
          relationType: relationType || "reference",
        };
      })
      .filter((entry): entry is { imageId: string; relationType: string } => Boolean(entry));

    if (roomIds.length > 0) {
      const roomRows = await db.select().from(rooms).where(inArray(rooms.id, roomIds)).all();
      if (roomRows.length !== roomIds.length) {
        return c.json({ error: "One or more roomIds are invalid" }, 404);
      }
    }

    if (supportingDocumentIds.length > 0) {
      const documentRows = await db
        .select()
        .from(supportingDocuments)
        .where(inArray(supportingDocuments.id, supportingDocumentIds))
        .all();
      if (documentRows.length !== supportingDocumentIds.length) {
        return c.json({ error: "One or more supportingDocumentIds are invalid" }, 404);
      }
    }

    if (imageRefs.length > 0) {
      const imageRows = await db
        .select()
        .from(images)
        .where(inArray(images.id, imageRefs.map((ref) => ref.imageId)))
        .all();
      if (imageRows.length !== imageRefs.length) {
        return c.json({ error: "One or more imageRefs.imageId values are invalid" }, 404);
      }
    }

    const id = crypto.randomUUID();
    const now = new Date();
    const estimatedCostCentsRaw = Number(body.estimatedCostCents);
    const sortOrderRaw = Number(body.sortOrder);
    const metadata = parseJsonObject(body.metadata);

    await db
      .insert(visionPlanNodes)
      .values({
        id,
        parentId,
        scenarioId,
        title,
        summary:
          typeof body.summary === "string" ? body.summary.trim() || null : null,
        nodeType: normalizeNodeType(body.nodeType),
        status: normalizeNodeStatus(body.status),
        estimatedCostCents: Number.isFinite(estimatedCostCentsRaw) ? Math.trunc(estimatedCostCentsRaw) : null,
        sortOrder: Number.isFinite(sortOrderRaw) ? Math.trunc(sortOrderRaw) : 0,
        thumbnailImageId:
          typeof body.thumbnailImageId === "string" && body.thumbnailImageId.trim().length > 0
            ? body.thumbnailImageId.trim()
            : null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .run();

    await replaceNodeMappings(db, id, {
      roomIds,
      imageRefs,
      supportingDocumentIds,
    });

    const payload = await buildVisionNodePayload(db, scenarioId || undefined);
    const createdNode = payload.nodes.find((node) => node.id === id) || null;

    return c.json(
      {
        success: true,
        node: createdNode,
      },
      201,
    );
  } catch (error) {
    return c.json(
      {
        error: "Failed to create vision node",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

visionNodesRouter.patch("/:id", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    await ensureHomeCatalogSeed(c.env);
    const nodeId = c.req.param("id");
    const body = (await c.req.json()) as Record<string, unknown>;

    const existing = await db
      .select()
      .from(visionPlanNodes)
      .where(eq(visionPlanNodes.id, nodeId))
      .get();
    if (!existing) {
      return c.json({ error: "Vision node not found" }, 404);
    }

    const updates: Record<string, unknown> = {
      datetimeUpdated: new Date(),
    };

    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) {
        return c.json({ error: "title cannot be empty" }, 400);
      }
      updates.title = title;
    }
    if (body.parentId !== undefined) {
      const parentId =
        typeof body.parentId === "string" && body.parentId.trim().length > 0
          ? body.parentId.trim()
          : null;
      if (parentId) {
        const parent = await db
          .select()
          .from(visionPlanNodes)
          .where(eq(visionPlanNodes.id, parentId))
          .get();
        if (!parent) {
          return c.json({ error: "parentId does not match an existing node" }, 404);
        }
      }
      updates.parentId = parentId;
    }
    if (body.scenarioId !== undefined) {
      const scenarioId =
        typeof body.scenarioId === "string" && body.scenarioId.trim().length > 0
          ? body.scenarioId.trim()
          : null;
      if (scenarioId) {
        const scenario = await db
          .select()
          .from(remodelScenarios)
          .where(eq(remodelScenarios.id, scenarioId))
          .get();
        if (!scenario) {
          return c.json({ error: "scenarioId does not match an existing scenario" }, 404);
        }
      }
      updates.scenarioId = scenarioId;
    }
    if (body.summary !== undefined) {
      updates.summary = typeof body.summary === "string" ? body.summary.trim() || null : null;
    }
    if (body.nodeType !== undefined) {
      updates.nodeType = normalizeNodeType(body.nodeType);
    }
    if (body.status !== undefined) {
      updates.status = normalizeNodeStatus(body.status);
    }
    if (body.estimatedCostCents !== undefined) {
      const parsed = Number(body.estimatedCostCents);
      updates.estimatedCostCents = Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }
    if (body.sortOrder !== undefined) {
      const parsed = Number(body.sortOrder);
      updates.sortOrder = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    }
    if (body.thumbnailImageId !== undefined) {
      updates.thumbnailImageId =
        typeof body.thumbnailImageId === "string" && body.thumbnailImageId.trim().length > 0
          ? body.thumbnailImageId.trim()
          : null;
    }
    if (body.metadata !== undefined) {
      const metadata = parseJsonObject(body.metadata);
      updates.metadata = metadata ? JSON.stringify(metadata) : null;
    }

    await db
      .update(visionPlanNodes)
      .set(updates)
      .where(eq(visionPlanNodes.id, nodeId))
      .run();

    const roomIdsProvided = Object.prototype.hasOwnProperty.call(body, "roomIds");
    const imageRefsProvided = Object.prototype.hasOwnProperty.call(body, "imageRefs");
    const supportingDocumentIdsProvided = Object.prototype.hasOwnProperty.call(
      body,
      "supportingDocumentIds",
    );

    if (roomIdsProvided || imageRefsProvided || supportingDocumentIdsProvided) {
      const roomIds = roomIdsProvided ? parseNumberArray(body.roomIds) : [];
      const supportingDocumentIds = supportingDocumentIdsProvided
        ? parseStringArray(body.supportingDocumentIds)
        : [];
      const imageRefsRaw = imageRefsProvided && Array.isArray(body.imageRefs) ? body.imageRefs : [];
      const imageRefs = imageRefsRaw
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const imageId =
            typeof (entry as Record<string, unknown>).imageId === "string"
              ? ((entry as Record<string, unknown>).imageId as string).trim()
              : "";
          if (!imageId) return null;
          const relationType =
            typeof (entry as Record<string, unknown>).relationType === "string"
              ? ((entry as Record<string, unknown>).relationType as string).trim().toLowerCase()
              : "reference";
          return {
            imageId,
            relationType: relationType || "reference",
          };
        })
        .filter((entry): entry is { imageId: string; relationType: string } => Boolean(entry));

      if (roomIdsProvided && roomIds.length > 0) {
        const roomRows = await db.select().from(rooms).where(inArray(rooms.id, roomIds)).all();
        if (roomRows.length !== roomIds.length) {
          return c.json({ error: "One or more roomIds are invalid" }, 404);
        }
      }
      if (supportingDocumentIdsProvided && supportingDocumentIds.length > 0) {
        const documentRows = await db
          .select()
          .from(supportingDocuments)
          .where(inArray(supportingDocuments.id, supportingDocumentIds))
          .all();
        if (documentRows.length !== supportingDocumentIds.length) {
          return c.json({ error: "One or more supportingDocumentIds are invalid" }, 404);
        }
      }
      if (imageRefsProvided && imageRefs.length > 0) {
        const imageRows = await db
          .select()
          .from(images)
          .where(inArray(images.id, imageRefs.map((ref) => ref.imageId)))
          .all();
        if (imageRows.length !== imageRefs.length) {
          return c.json({ error: "One or more imageRefs.imageId values are invalid" }, 404);
        }
      }

      const currentRoomMappings = await db
        .select()
        .from(visionNodeRoomMappings)
        .where(eq(visionNodeRoomMappings.visionNodeId, nodeId))
        .all();
      const currentImageMappings = await db
        .select()
        .from(visionNodeImageMappings)
        .where(eq(visionNodeImageMappings.visionNodeId, nodeId))
        .all();
      const currentDocMappings = await db
        .select()
        .from(supportingDocumentVisionNodeMappings)
        .where(eq(supportingDocumentVisionNodeMappings.visionNodeId, nodeId))
        .all();

      await replaceNodeMappings(db, nodeId, {
        roomIds: roomIdsProvided
          ? roomIds
          : currentRoomMappings.map((row) => row.roomId),
        imageRefs: imageRefsProvided
          ? imageRefs
          : currentImageMappings.map((row) => ({
              imageId: row.imageId,
              relationType: row.relationType,
            })),
        supportingDocumentIds: supportingDocumentIdsProvided
          ? supportingDocumentIds
          : currentDocMappings.map((row) => row.supportingDocumentId),
      });
    }

    const scenarioId = typeof updates.scenarioId === "string" ? updates.scenarioId : existing.scenarioId || undefined;
    const payload = await buildVisionNodePayload(db, scenarioId || undefined);
    const updatedNode = payload.nodes.find((node) => node.id === nodeId) || null;

    return c.json({
      success: true,
      node: updatedNode,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update vision node",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

visionNodesRouter.get("/:id", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const nodeId = c.req.param("id");
    const node = await db.select().from(visionPlanNodes).where(eq(visionPlanNodes.id, nodeId)).get();
    if (!node) {
      return c.json({ error: "Vision node not found" }, 404);
    }

    const payload = await buildVisionNodePayload(db, node.scenarioId || undefined);
    const selected = payload.nodes.find((entry) => entry.id === nodeId) || null;
    return c.json({
      success: true,
      node: selected,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to fetch vision node",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

visionNodesRouter.get("/:id/children", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const nodeId = c.req.param("id");
    const children = await db
      .select()
      .from(visionPlanNodes)
      .where(eq(visionPlanNodes.parentId, nodeId))
      .orderBy(asc(visionPlanNodes.sortOrder), asc(visionPlanNodes.datetimeCreated))
      .all();

    return c.json({
      success: true,
      count: children.length,
      children,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list child vision nodes",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

visionNodesRouter.delete("/:id", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const nodeId = c.req.param("id");
    const node = await db.select().from(visionPlanNodes).where(eq(visionPlanNodes.id, nodeId)).get();
    if (!node) {
      return c.json({ error: "Vision node not found" }, 404);
    }

    const children = await db
      .select()
      .from(visionPlanNodes)
      .where(eq(visionPlanNodes.parentId, nodeId))
      .all();
    if (children.length > 0) {
      return c.json(
        {
          error: "Cannot delete a node that still has children. Re-parent or delete descendants first.",
        },
        409,
      );
    }

    await Promise.all([
      db
        .delete(visionNodeRoomMappings)
        .where(eq(visionNodeRoomMappings.visionNodeId, nodeId))
        .run(),
      db
        .delete(visionNodeImageMappings)
        .where(eq(visionNodeImageMappings.visionNodeId, nodeId))
        .run(),
      db
        .delete(supportingDocumentVisionNodeMappings)
        .where(eq(supportingDocumentVisionNodeMappings.visionNodeId, nodeId))
        .run(),
    ]);
    await db.delete(visionPlanNodes).where(eq(visionPlanNodes.id, nodeId)).run();

    return c.json({
      success: true,
      deletedId: nodeId,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to delete vision node",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

visionNodesRouter.get("/summary/all", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const nodes = await db.select().from(visionPlanNodes).all();
    const activeByStatus: Record<string, number> = {};
    for (const node of nodes) {
      activeByStatus[node.status] = (activeByStatus[node.status] || 0) + 1;
    }
    return c.json({
      success: true,
      summary: {
        total: nodes.length,
        byStatus: activeByStatus,
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load vision summary",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { visionNodesRouter };
