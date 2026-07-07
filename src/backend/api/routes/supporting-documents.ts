import {
  documentEntityAssociations,
  remodelScenarios,
  rooms,
  supportingDocumentRoomMappings,
  supportingDocumentScenarioMappings,
  supportingDocuments,
  supportingDocumentVisionNodeMappings,
  visionPlanNodes,
} from "@backend/db";
import { ensureHomeCatalogSeed } from "@backend/services/home-catalog";
import { improveDescription, summarizeDocumentForRoom } from "@backend/services/ai-text";
import { extractAndEmbedDocument } from "@backend/services/documents/extraction";
import {
  escapeLikeTerm,
  likeEscaped,
  selectDocumentsByIds,
} from "@backend/services/documents/db-helpers";
import { isRequestAuthenticated, requireAccessAuth } from "@backend/utils/access";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";

const supportingDocumentsRouter = new Hono<{ Bindings: Env }>();

const ENTITY_TYPES = ["company", "brand", "product", "showroom", "permit", "floor"] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

function isValidEntityType(value: unknown): value is EntityType {
  return typeof value === "string" && (ENTITY_TYPES as readonly string[]).includes(value);
}

function normalizeDocType(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toUpperCase();
  return trimmed || null;
}

type SourceType = "pdf" | "image" | "video" | "screenshot" | "url" | "text" | "other";

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

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  return fallback;
}

function normalizeSourceType(raw: unknown, fallback: SourceType = "other"): SourceType {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (
    value === "pdf" ||
    value === "image" ||
    value === "video" ||
    value === "screenshot" ||
    value === "url" ||
    value === "text" ||
    value === "other"
  ) {
    return value;
  }
  return fallback;
}

function sourceTypeFromMime(mimeType: string | null | undefined): SourceType {
  if (!mimeType) return "other";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("text/")) return "text";
  return "other";
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

function parseEpochDateInput(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }
  return null;
}

function safeTitleFromFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) return "Untitled supporting document";
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0) return trimmed;
  return trimmed.slice(0, dotIndex).trim() || trimmed;
}

function objectKeyForUpload(filename: string): string {
  const now = new Date();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `supporting-documents/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}-${safeName}`;
}

async function loadDocumentMappings(
  db: ReturnType<typeof drizzle>,
  documentIds: string[],
): Promise<{
  roomIdsByDoc: Map<string, number[]>;
  roomLabelsByDoc: Map<string, string[]>;
  scenarioIdsByDoc: Map<string, string[]>;
  scenarioNamesByDoc: Map<string, string[]>;
  nodeIdsByDoc: Map<string, string[]>;
  nodeTitlesByDoc: Map<string, string[]>;
}> {
  const roomIdsByDoc = new Map<string, number[]>();
  const roomLabelsByDoc = new Map<string, string[]>();
  const scenarioIdsByDoc = new Map<string, string[]>();
  const scenarioNamesByDoc = new Map<string, string[]>();
  const nodeIdsByDoc = new Map<string, string[]>();
  const nodeTitlesByDoc = new Map<string, string[]>();

  if (documentIds.length === 0) {
    return {
      roomIdsByDoc,
      roomLabelsByDoc,
      scenarioIdsByDoc,
      scenarioNamesByDoc,
      nodeIdsByDoc,
      nodeTitlesByDoc,
    };
  }

  const [roomMappings, scenarioMappings, nodeMappings] = await Promise.all([
    db
      .select()
      .from(supportingDocumentRoomMappings)
      .where(inArray(supportingDocumentRoomMappings.supportingDocumentId, documentIds))
      .all(),
    db
      .select()
      .from(supportingDocumentScenarioMappings)
      .where(inArray(supportingDocumentScenarioMappings.supportingDocumentId, documentIds))
      .all(),
    db
      .select()
      .from(supportingDocumentVisionNodeMappings)
      .where(inArray(supportingDocumentVisionNodeMappings.supportingDocumentId, documentIds))
      .all(),
  ]);

  const uniqueRoomIds = Array.from(new Set(roomMappings.map((row) => row.roomId)));
  const uniqueScenarioIds = Array.from(new Set(scenarioMappings.map((row) => row.scenarioId)));
  const uniqueNodeIds = Array.from(new Set(nodeMappings.map((row) => row.visionNodeId)));

  const [roomRows, scenarioRows, nodeRows] = await Promise.all([
    uniqueRoomIds.length > 0
      ? db.select().from(rooms).where(inArray(rooms.id, uniqueRoomIds)).all()
      : Promise.resolve([]),
    uniqueScenarioIds.length > 0
      ? db
          .select()
          .from(remodelScenarios)
          .where(inArray(remodelScenarios.id, uniqueScenarioIds))
          .all()
      : Promise.resolve([]),
    uniqueNodeIds.length > 0
      ? db.select().from(visionPlanNodes).where(inArray(visionPlanNodes.id, uniqueNodeIds)).all()
      : Promise.resolve([]),
  ]);

  const roomNameById = new Map(roomRows.map((row) => [row.id, row.roomName]));
  const scenarioNameById = new Map(scenarioRows.map((row) => [row.id, row.name]));
  const nodeTitleById = new Map(nodeRows.map((row) => [row.id, row.title]));

  for (const row of roomMappings) {
    const ids = roomIdsByDoc.get(row.supportingDocumentId) || [];
    if (!ids.includes(row.roomId)) ids.push(row.roomId);
    roomIdsByDoc.set(row.supportingDocumentId, ids);
  }
  for (const [docId, ids] of roomIdsByDoc.entries()) {
    roomLabelsByDoc.set(
      docId,
      ids
        .map((id) => roomNameById.get(id))
        .filter((value): value is string => typeof value === "string"),
    );
  }

  for (const row of scenarioMappings) {
    const ids = scenarioIdsByDoc.get(row.supportingDocumentId) || [];
    if (!ids.includes(row.scenarioId)) ids.push(row.scenarioId);
    scenarioIdsByDoc.set(row.supportingDocumentId, ids);
  }
  for (const [docId, ids] of scenarioIdsByDoc.entries()) {
    scenarioNamesByDoc.set(
      docId,
      ids
        .map((id) => scenarioNameById.get(id))
        .filter((value): value is string => typeof value === "string"),
    );
  }

  for (const row of nodeMappings) {
    const ids = nodeIdsByDoc.get(row.supportingDocumentId) || [];
    if (!ids.includes(row.visionNodeId)) ids.push(row.visionNodeId);
    nodeIdsByDoc.set(row.supportingDocumentId, ids);
  }
  for (const [docId, ids] of nodeIdsByDoc.entries()) {
    nodeTitlesByDoc.set(
      docId,
      ids
        .map((id) => nodeTitleById.get(id))
        .filter((value): value is string => typeof value === "string"),
    );
  }

  return {
    roomIdsByDoc,
    roomLabelsByDoc,
    scenarioIdsByDoc,
    scenarioNamesByDoc,
    nodeIdsByDoc,
    nodeTitlesByDoc,
  };
}

async function replaceDocumentMappings(
  db: ReturnType<typeof drizzle>,
  documentId: string,
  params: {
    roomIds?: number[];
    scenarioIds?: string[];
    visionNodeIds?: string[];
  },
) {
  const roomIds = params.roomIds || [];
  const scenarioIds = params.scenarioIds || [];
  const visionNodeIds = params.visionNodeIds || [];

  await Promise.all([
    db
      .delete(supportingDocumentRoomMappings)
      .where(eq(supportingDocumentRoomMappings.supportingDocumentId, documentId))
      .run(),
    db
      .delete(supportingDocumentScenarioMappings)
      .where(eq(supportingDocumentScenarioMappings.supportingDocumentId, documentId))
      .run(),
    db
      .delete(supportingDocumentVisionNodeMappings)
      .where(eq(supportingDocumentVisionNodeMappings.supportingDocumentId, documentId))
      .run(),
  ]);

  if (roomIds.length > 0) {
    await db
      .insert(supportingDocumentRoomMappings)
      .values(
        roomIds.map((roomId) => ({
          supportingDocumentId: documentId,
          roomId,
        })),
      )
      .onConflictDoNothing()
      .run();
  }

  if (scenarioIds.length > 0) {
    await db
      .insert(supportingDocumentScenarioMappings)
      .values(
        scenarioIds.map((scenarioId) => ({
          supportingDocumentId: documentId,
          scenarioId,
        })),
      )
      .onConflictDoNothing()
      .run();
  }

  if (visionNodeIds.length > 0) {
    await db
      .insert(supportingDocumentVisionNodeMappings)
      .values(
        visionNodeIds.map((visionNodeId) => ({
          supportingDocumentId: documentId,
          visionNodeId,
        })),
      )
      .onConflictDoNothing()
      .run();
  }
}

supportingDocumentsRouter.get("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const roomIdQuery = Number(c.req.query("roomId"));
    const scenarioIdQuery = c.req.query("scenarioId")?.trim() || "";
    const visionNodeIdQuery = c.req.query("visionNodeId")?.trim() || "";
    const sourceTypeQuery = c.req.query("sourceType")?.trim().toLowerCase() || "";
    const includeInactive = c.req.query("includeInactive") === "true";

    const rows = includeInactive
      ? await db
          .select()
          .from(supportingDocuments)
          .orderBy(desc(supportingDocuments.datetimeUpdated))
          .all()
      : await db
          .select()
          .from(supportingDocuments)
          .where(eq(supportingDocuments.isActive, true))
          .orderBy(desc(supportingDocuments.datetimeUpdated))
          .all();

    const documentIds = rows.map((row) => row.id);
    const mappings = await loadDocumentMappings(db, documentIds);

    const filtered = rows.filter((row) => {
      if (sourceTypeQuery && row.sourceType !== sourceTypeQuery) {
        return false;
      }

      const roomIds = mappings.roomIdsByDoc.get(row.id) || [];
      const scenarioIds = mappings.scenarioIdsByDoc.get(row.id) || [];
      const nodeIds = mappings.nodeIdsByDoc.get(row.id) || [];

      if (Number.isFinite(roomIdQuery) && roomIdQuery > 0 && !roomIds.includes(roomIdQuery)) {
        return false;
      }
      if (scenarioIdQuery && !scenarioIds.includes(scenarioIdQuery)) {
        return false;
      }
      if (visionNodeIdQuery && !nodeIds.includes(visionNodeIdQuery)) {
        return false;
      }
      return true;
    });

    return c.json({
      success: true,
      count: filtered.length,
      documents: filtered.map((row) => ({
        ...row,
        tags: parseStringArray(row.tagsJson),
        roomIds: mappings.roomIdsByDoc.get(row.id) || [],
        roomLabels: mappings.roomLabelsByDoc.get(row.id) || [],
        scenarioIds: mappings.scenarioIdsByDoc.get(row.id) || [],
        scenarioNames: mappings.scenarioNamesByDoc.get(row.id) || [],
        visionNodeIds: mappings.nodeIdsByDoc.get(row.id) || [],
        visionNodeTitles: mappings.nodeTitlesByDoc.get(row.id) || [],
      })),
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list supporting documents",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

supportingDocumentsRouter.get("/summary", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const rows = await db.select().from(supportingDocuments).all();
    const activeRows = rows.filter((row) => row.isActive);
    const bySourceType: Record<string, number> = {};
    for (const row of activeRows) {
      bySourceType[row.sourceType] = (bySourceType[row.sourceType] || 0) + 1;
    }
    return c.json({
      success: true,
      summary: {
        total: rows.length,
        active: activeRows.length,
        inactive: rows.length - activeRows.length,
        factRecords: activeRows.filter((row) => row.isFactRecord).length,
        bySourceType,
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load supporting document summary",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// P2-02 — GET /api/supporting-documents/public
// ---------------------------------------------------------------------------
/**
 * Public, unauthenticated, lean listing: only visibility="public" AND
 * isActive documents. This is what the public /docs page calls. Registered
 * BEFORE GET /:id so "public" is never captured as a document id param.
 *
 * Does NOT change the existing GET / behavior (still returns everything to
 * anyone, unauthenticated, per existing pages' expectations).
 */
supportingDocumentsRouter.get("/public", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const rows = await db
      .select()
      .from(supportingDocuments)
      .where(and(eq(supportingDocuments.visibility, "public"), eq(supportingDocuments.isActive, true)))
      .orderBy(desc(supportingDocuments.datetimeUpdated))
      .all();

    return c.json({
      success: true,
      count: rows.length,
      documents: rows.map((row) => ({
        id: row.id,
        title: row.title,
        sourceType: row.sourceType,
        mimeType: row.mimeType,
        docType: row.docType,
        tags: parseStringArray(row.tagsJson),
        r2Url: row.r2Url,
        externalUrl: row.externalUrl,
        description: row.description,
        createdAt: row.datetimeCreated,
      })),
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list public supporting documents",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// P2-05 — GET /api/supporting-documents/by-entity?entityType=&entityId=
// ---------------------------------------------------------------------------
/**
 * Reverse lookup: all documents associated to one entity (company, brand,
 * product, showroom, permit, floor) via documentEntityAssociations — powers
 * the Documents tab on entity detail pages. Read-only, open like the router's
 * other reads (the entity pages are admin-gated at the page level).
 * Registered BEFORE GET /:id so "by-entity" is never captured as an id.
 */
supportingDocumentsRouter.get("/by-entity", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const entityType = c.req.query("entityType");
    const entityId = c.req.query("entityId")?.trim();

    if (!isValidEntityType(entityType)) {
      return c.json(
        { error: `entityType must be one of: ${ENTITY_TYPES.join(", ")}` },
        400,
      );
    }
    if (!entityId) {
      return c.json({ error: "entityId is required" }, 400);
    }

    const assocRows = await db
      .select({ documentId: documentEntityAssociations.documentId })
      .from(documentEntityAssociations)
      .where(
        and(
          eq(documentEntityAssociations.entityType, entityType),
          eq(documentEntityAssociations.entityId, entityId),
        ),
      )
      .all();

    if (assocRows.length === 0) {
      return c.json({ success: true, count: 0, documents: [] });
    }

    // Chunked — the association list is unbounded and D1 caps bound params.
    const rows = await selectDocumentsByIds(
      db,
      assocRows.map((row) => row.documentId),
    );
    const documents = rows
      .filter((row) => row.isActive)
      .sort((a, b) => b.datetimeUpdated.getTime() - a.datetimeUpdated.getTime())
      .map((row) => ({
        id: row.id,
        title: row.title,
        sourceType: row.sourceType,
        mimeType: row.mimeType,
        docType: row.docType,
        visibility: row.visibility,
        extractionStatus: row.extractionStatus,
        tags: parseStringArray(row.tagsJson),
        r2Url: row.r2Url,
        externalUrl: row.externalUrl,
        description: row.description,
        createdAt: row.datetimeCreated,
      }));

    return c.json({ success: true, count: documents.length, documents });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list documents for entity",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// P2-02 — GET /api/supporting-documents/search?q=
// ---------------------------------------------------------------------------
/**
 * Hybrid search: Vectorize semantic search (bge-large embedding of `q` against
 * VECTOR_INDEX, filtered to kind="document") merged with a D1 keyword LIKE
 * search over title/description/extractedText, deduped by documentId.
 *
 * Visibility: unauthenticated (public) callers only see visibility="public"
 * docs; callers holding a valid remodel_access cookie see everything.
 * Registered BEFORE GET /:id so "search" is never captured as a document id.
 */
supportingDocumentsRouter.get("/search", async (c) => {
  try {
    const q = c.req.query("q")?.trim() || "";
    if (!q) {
      return c.json({ error: "q is required" }, 400);
    }

    const authenticated = await isRequestAuthenticated(c.req.raw, c.env);
    const db = drizzle(c.env.DB);

    // --- Vectorize semantic search ---
    const vectorScoreByDocId = new Map<string, number>();
    try {
      const embedResult = (await c.env.AI.run("@cf/baai/bge-large-en-v1.5", {
        text: [q],
      })) as { data: number[][] };
      const vector = embedResult.data?.[0];
      if (vector) {
        const matches = await c.env.VECTOR_INDEX.query(vector, {
          topK: 10,
          filter: { kind: "document" },
          returnMetadata: "all",
        });
        for (const match of matches.matches) {
          const docId =
            typeof match.metadata?.documentId === "string" ? match.metadata.documentId : null;
          if (!docId) continue;
          const existing = vectorScoreByDocId.get(docId);
          if (existing === undefined || match.score > existing) {
            vectorScoreByDocId.set(docId, match.score);
          }
        }
      }
    } catch (vectorError) {
      // Non-fatal — fall back to keyword-only results.
      console.error("[supporting-documents/search] vectorize query failed:", vectorError);
    }

    // --- D1 keyword LIKE search ---
    const likePattern = `%${escapeLikeTerm(q)}%`;
    const keywordRows = await db
      .select()
      .from(supportingDocuments)
      .where(
        and(
          eq(supportingDocuments.isActive, true),
          or(
            likeEscaped(supportingDocuments.title, likePattern),
            likeEscaped(supportingDocuments.description, likePattern),
            likeEscaped(supportingDocuments.extractedText, likePattern),
          ),
        ),
      )
      .all();

    const candidateIds = new Set<string>([
      ...vectorScoreByDocId.keys(),
      ...keywordRows.map((row) => row.id),
    ]);

    if (candidateIds.size === 0) {
      return c.json({ success: true, query: q, count: 0, results: [] });
    }

    // Chunked — candidateIds is unbounded and D1 caps bound params at 100.
    const rows = await selectDocumentsByIds(db, Array.from(candidateIds));

    const rowById = new Map(rows.map((row) => [row.id, row]));

    function buildSnippet(row: (typeof rows)[number]): string {
      const haystacks = [row.extractedText, row.description, row.title];
      const lowerQ = q.toLowerCase();
      for (const haystack of haystacks) {
        if (!haystack) continue;
        const idx = haystack.toLowerCase().indexOf(lowerQ);
        if (idx >= 0) {
          const start = Math.max(0, idx - 80);
          const end = Math.min(haystack.length, idx + q.length + 80);
          return `${start > 0 ? "…" : ""}${haystack.slice(start, end).trim()}${end < haystack.length ? "…" : ""}`;
        }
      }
      return row.description || row.title;
    }

    const results = Array.from(candidateIds)
      .map((docId) => rowById.get(docId))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => authenticated || row.visibility === "public")
      .map((row) => ({
        id: row.id,
        title: row.title,
        sourceType: row.sourceType,
        docType: row.docType,
        visibility: row.visibility,
        tags: parseStringArray(row.tagsJson),
        r2Url: row.r2Url,
        externalUrl: row.externalUrl,
        snippet: buildSnippet(row),
        vectorScore: vectorScoreByDocId.get(row.id) ?? null,
        matchedKeyword: keywordRows.some((kr) => kr.id === row.id),
      }))
      .sort((a, b) => (b.vectorScore ?? 0) - (a.vectorScore ?? 0));

    return c.json({ success: true, query: q, count: results.length, results });
  } catch (error) {
    return c.json(
      {
        error: "Failed to search supporting documents",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

supportingDocumentsRouter.post("/", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    await ensureHomeCatalogSeed(c.env);
    const body = (await c.req.json()) as Record<string, unknown>;

    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return c.json({ error: "title is required" }, 400);
    }

    const sourceType = normalizeSourceType(body.sourceType, "other");
    const roomIds = parseNumberArray(body.roomIds);
    const scenarioIds = parseStringArray(body.scenarioIds);
    const visionNodeIds = parseStringArray(body.visionNodeIds);
    const tags = parseStringArray(body.tags);
    const metadata = parseJsonObject(body.metadata);
    const revisionOfId =
      typeof body.revisionOfId === "string" && body.revisionOfId.trim().length > 0
        ? body.revisionOfId.trim()
        : null;
    const createdAt = parseEpochDateInput(body.datetimeCreated);
    const updatedAt = parseEpochDateInput(body.datetimeUpdated);

    if (roomIds.length > 0) {
      const roomRows = await db.select().from(rooms).where(inArray(rooms.id, roomIds)).all();
      if (roomRows.length !== roomIds.length) {
        return c.json({ error: "One or more roomIds are invalid" }, 404);
      }
    }

    if (scenarioIds.length > 0) {
      const scenarioRows = await db
        .select()
        .from(remodelScenarios)
        .where(inArray(remodelScenarios.id, scenarioIds))
        .all();
      if (scenarioRows.length !== scenarioIds.length) {
        return c.json({ error: "One or more scenarioIds are invalid" }, 404);
      }
    }

    if (visionNodeIds.length > 0) {
      const nodeRows = await db
        .select()
        .from(visionPlanNodes)
        .where(inArray(visionPlanNodes.id, visionNodeIds))
        .all();
      if (nodeRows.length !== visionNodeIds.length) {
        return c.json({ error: "One or more visionNodeIds are invalid" }, 404);
      }
    }

    const id = crypto.randomUUID();
    const now = new Date();

    let revisionNumber = 1;
    if (revisionOfId) {
      const revisionRows = await db
        .select()
        .from(supportingDocuments)
        .where(eq(supportingDocuments.revisionOfId, revisionOfId))
        .all();
      const rootDoc = await db
        .select()
        .from(supportingDocuments)
        .where(eq(supportingDocuments.id, revisionOfId))
        .get();
      const maxRevision = Math.max(
        rootDoc?.revisionNumber || 1,
        ...revisionRows.map((row) => row.revisionNumber),
      );
      revisionNumber = maxRevision + 1;
    }

    await db
      .insert(supportingDocuments)
      .values({
        id,
        title,
        sourceType,
        mimeType: typeof body.mimeType === "string" ? body.mimeType.trim() || null : null,
        r2ObjectKey: typeof body.r2ObjectKey === "string" ? body.r2ObjectKey.trim() || null : null,
        r2Url: typeof body.r2Url === "string" ? body.r2Url.trim() || null : null,
        externalUrl: typeof body.externalUrl === "string" ? body.externalUrl.trim() || null : null,
        description: typeof body.description === "string" ? body.description.trim() || null : null,
        tagsJson: tags.length > 0 ? JSON.stringify(tags) : null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        isActive: parseBoolean(body.isActive, true),
        isFactRecord: parseBoolean(body.isFactRecord, false),
        revisionNumber,
        revisionOfId,
        replacedById: null,
        aiRationale: typeof body.aiRationale === "string" ? body.aiRationale.trim() || null : null,
        datetimeCreated: createdAt || now,
        datetimeUpdated: updatedAt || now,
      })
      .run();

    await replaceDocumentMappings(db, id, {
      roomIds,
      scenarioIds,
      visionNodeIds,
    });

    const created = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, id))
      .get();
    const mappings = await loadDocumentMappings(db, [id]);

    return c.json(
      {
        success: true,
        document: created
          ? {
              ...created,
              tags: parseStringArray(created.tagsJson),
              roomIds: mappings.roomIdsByDoc.get(id) || [],
              roomLabels: mappings.roomLabelsByDoc.get(id) || [],
              scenarioIds: mappings.scenarioIdsByDoc.get(id) || [],
              scenarioNames: mappings.scenarioNamesByDoc.get(id) || [],
              visionNodeIds: mappings.nodeIdsByDoc.get(id) || [],
              visionNodeTitles: mappings.nodeTitlesByDoc.get(id) || [],
            }
          : null,
      },
      201,
    );
  } catch (error) {
    return c.json(
      {
        error: "Failed to create supporting document",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

supportingDocumentsRouter.post("/upload", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    await ensureHomeCatalogSeed(c.env);
    const formData = await c.req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return c.json({ error: "file is required" }, 400);
    }

    const explicitTitle = formData.get("title");
    const title =
      typeof explicitTitle === "string" && explicitTitle.trim().length > 0
        ? explicitTitle.trim()
        : safeTitleFromFilename(file.name);

    const sourceType = normalizeSourceType(
      formData.get("sourceType"),
      sourceTypeFromMime(file.type),
    );
    const descriptionRaw = formData.get("description");
    const aiRationaleRaw = formData.get("aiRationale");
    const externalUrlRaw = formData.get("externalUrl");
    const tags = parseStringArray(formData.get("tags"));
    const roomIds = parseNumberArray(formData.getAll("roomIds"));
    const scenarioIds = parseStringArray(formData.getAll("scenarioIds"));
    const visionNodeIds = parseStringArray(formData.getAll("visionNodeIds"));
    const isFactRecord = parseBoolean(formData.get("isFactRecord"), false);
    const metadata = parseJsonObject(formData.get("metadata"));

    if (roomIds.length > 0) {
      const roomRows = await db.select().from(rooms).where(inArray(rooms.id, roomIds)).all();
      if (roomRows.length !== roomIds.length) {
        return c.json({ error: "One or more roomIds are invalid" }, 404);
      }
    }

    if (scenarioIds.length > 0) {
      const scenarioRows = await db
        .select()
        .from(remodelScenarios)
        .where(inArray(remodelScenarios.id, scenarioIds))
        .all();
      if (scenarioRows.length !== scenarioIds.length) {
        return c.json({ error: "One or more scenarioIds are invalid" }, 404);
      }
    }

    if (visionNodeIds.length > 0) {
      const nodeRows = await db
        .select()
        .from(visionPlanNodes)
        .where(inArray(visionPlanNodes.id, visionNodeIds))
        .all();
      if (nodeRows.length !== visionNodeIds.length) {
        return c.json({ error: "One or more visionNodeIds are invalid" }, 404);
      }
    }

    const objectKey = objectKeyForUpload(file.name);
    const bytes = await file.arrayBuffer();
    await c.env.ARTIFACTS_BUCKET.put(objectKey, bytes, {
      httpMetadata: {
        contentType: file.type || "application/octet-stream",
      },
      customMetadata: {
        sourceType,
        uploadedAt: new Date().toISOString(),
      },
    });

    const id = crypto.randomUUID();
    const now = new Date();

    await db
      .insert(supportingDocuments)
      .values({
        id,
        title,
        sourceType,
        mimeType: file.type || null,
        r2ObjectKey: objectKey,
        r2Url: `/api/artifacts/${objectKey}`,
        externalUrl: typeof externalUrlRaw === "string" ? externalUrlRaw.trim() || null : null,
        description: typeof descriptionRaw === "string" ? descriptionRaw.trim() || null : null,
        tagsJson: tags.length > 0 ? JSON.stringify(tags) : null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        isFactRecord,
        isActive: true,
        revisionNumber: 1,
        aiRationale: typeof aiRationaleRaw === "string" ? aiRationaleRaw.trim() || null : null,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .run();

    await replaceDocumentMappings(db, id, {
      roomIds,
      scenarioIds,
      visionNodeIds,
    });

    const created = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, id))
      .get();
    const mappings = await loadDocumentMappings(db, [id]);

    // Kick off text extraction + embedding in the background — never block the
    // upload response on OCR/toMarkdown/Vectorize latency. extractAndEmbedDocument
    // never throws, so this is safe fire-and-forget via waitUntil.
    c.executionCtx.waitUntil(extractAndEmbedDocument(c.env, id));

    return c.json(
      {
        success: true,
        document: created
          ? {
              ...created,
              tags: parseStringArray(created.tagsJson),
              roomIds: mappings.roomIdsByDoc.get(id) || [],
              roomLabels: mappings.roomLabelsByDoc.get(id) || [],
              scenarioIds: mappings.scenarioIdsByDoc.get(id) || [],
              scenarioNames: mappings.scenarioNamesByDoc.get(id) || [],
              visionNodeIds: mappings.nodeIdsByDoc.get(id) || [],
              visionNodeTitles: mappings.nodeTitlesByDoc.get(id) || [],
            }
          : null,
      },
      201,
    );
  } catch (error) {
    return c.json(
      {
        error: "Failed to upload supporting document",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

supportingDocumentsRouter.patch("/:id", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const documentId = c.req.param("id");
    const body = (await c.req.json()) as Record<string, unknown>;

    const existing = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, documentId))
      .get();
    if (!existing) {
      return c.json({ error: "Supporting document not found" }, 404);
    }

    const createRevision = parseBoolean(body.createRevision, false);
    const roomIdsProvided = Object.prototype.hasOwnProperty.call(body, "roomIds");
    const scenarioIdsProvided = Object.prototype.hasOwnProperty.call(body, "scenarioIds");
    const visionNodeIdsProvided = Object.prototype.hasOwnProperty.call(body, "visionNodeIds");
    const roomIds = roomIdsProvided ? parseNumberArray(body.roomIds) : [];
    const scenarioIds = scenarioIdsProvided ? parseStringArray(body.scenarioIds) : [];
    const visionNodeIds = visionNodeIdsProvided ? parseStringArray(body.visionNodeIds) : [];

    if (roomIdsProvided && roomIds.length > 0) {
      const roomRows = await db.select().from(rooms).where(inArray(rooms.id, roomIds)).all();
      if (roomRows.length !== roomIds.length) {
        return c.json({ error: "One or more roomIds are invalid" }, 404);
      }
    }
    if (scenarioIdsProvided && scenarioIds.length > 0) {
      const scenarioRows = await db
        .select()
        .from(remodelScenarios)
        .where(inArray(remodelScenarios.id, scenarioIds))
        .all();
      if (scenarioRows.length !== scenarioIds.length) {
        return c.json({ error: "One or more scenarioIds are invalid" }, 404);
      }
    }
    if (visionNodeIdsProvided && visionNodeIds.length > 0) {
      const nodeRows = await db
        .select()
        .from(visionPlanNodes)
        .where(inArray(visionPlanNodes.id, visionNodeIds))
        .all();
      if (nodeRows.length !== visionNodeIds.length) {
        return c.json({ error: "One or more visionNodeIds are invalid" }, 404);
      }
    }

    if (!createRevision) {
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
      if (body.sourceType !== undefined) {
        updates.sourceType = normalizeSourceType(
          body.sourceType,
          normalizeSourceType(existing.sourceType),
        );
      }
      if (body.description !== undefined) {
        updates.description =
          typeof body.description === "string" ? body.description.trim() || null : null;
      }
      if (body.externalUrl !== undefined) {
        updates.externalUrl =
          typeof body.externalUrl === "string" ? body.externalUrl.trim() || null : null;
      }
      if (body.aiRationale !== undefined) {
        updates.aiRationale =
          typeof body.aiRationale === "string" ? body.aiRationale.trim() || null : null;
      }
      if (body.isFactRecord !== undefined) {
        updates.isFactRecord = parseBoolean(body.isFactRecord, existing.isFactRecord);
      }
      if (body.isActive !== undefined) {
        updates.isActive = parseBoolean(body.isActive, existing.isActive);
      }
      if (body.tags !== undefined) {
        const tags = parseStringArray(body.tags);
        updates.tagsJson = tags.length > 0 ? JSON.stringify(tags) : null;
      }
      if (body.metadata !== undefined) {
        const metadata = parseJsonObject(body.metadata);
        updates.metadata = metadata ? JSON.stringify(metadata) : null;
      }

      await db
        .update(supportingDocuments)
        .set(updates)
        .where(eq(supportingDocuments.id, documentId))
        .run();

      if (roomIdsProvided || scenarioIdsProvided || visionNodeIdsProvided) {
        const currentMappings = await loadDocumentMappings(db, [documentId]);
        await replaceDocumentMappings(db, documentId, {
          roomIds: roomIdsProvided ? roomIds : currentMappings.roomIdsByDoc.get(documentId) || [],
          scenarioIds: scenarioIdsProvided
            ? scenarioIds
            : currentMappings.scenarioIdsByDoc.get(documentId) || [],
          visionNodeIds: visionNodeIdsProvided
            ? visionNodeIds
            : currentMappings.nodeIdsByDoc.get(documentId) || [],
        });
      }

      const updated = await db
        .select()
        .from(supportingDocuments)
        .where(eq(supportingDocuments.id, documentId))
        .get();
      const mappings = await loadDocumentMappings(db, [documentId]);

      return c.json({
        success: true,
        document: updated
          ? {
              ...updated,
              tags: parseStringArray(updated.tagsJson),
              roomIds: mappings.roomIdsByDoc.get(documentId) || [],
              roomLabels: mappings.roomLabelsByDoc.get(documentId) || [],
              scenarioIds: mappings.scenarioIdsByDoc.get(documentId) || [],
              scenarioNames: mappings.scenarioNamesByDoc.get(documentId) || [],
              visionNodeIds: mappings.nodeIdsByDoc.get(documentId) || [],
              visionNodeTitles: mappings.nodeTitlesByDoc.get(documentId) || [],
            }
          : null,
      });
    }

    const rootId = existing.revisionOfId || existing.id;
    const revisionRows = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.revisionOfId, rootId))
      .all();
    const maxRevision = Math.max(
      existing.revisionNumber,
      ...revisionRows.map((row) => row.revisionNumber),
    );

    const nextId = crypto.randomUUID();
    const now = new Date();
    const tags =
      body.tags !== undefined ? parseStringArray(body.tags) : parseStringArray(existing.tagsJson);
    const nextMetadata =
      body.metadata !== undefined
        ? parseJsonObject(body.metadata)
        : parseJsonObject(existing.metadata);

    await db
      .insert(supportingDocuments)
      .values({
        id: nextId,
        title:
          body.title !== undefined && typeof body.title === "string" && body.title.trim().length > 0
            ? body.title.trim()
            : existing.title,
        sourceType:
          body.sourceType !== undefined
            ? normalizeSourceType(body.sourceType, normalizeSourceType(existing.sourceType))
            : normalizeSourceType(existing.sourceType),
        mimeType:
          body.mimeType !== undefined
            ? typeof body.mimeType === "string"
              ? body.mimeType.trim() || null
              : null
            : existing.mimeType,
        r2ObjectKey:
          body.r2ObjectKey !== undefined
            ? typeof body.r2ObjectKey === "string"
              ? body.r2ObjectKey.trim() || null
              : null
            : existing.r2ObjectKey,
        r2Url:
          body.r2Url !== undefined
            ? typeof body.r2Url === "string"
              ? body.r2Url.trim() || null
              : null
            : existing.r2Url,
        externalUrl:
          body.externalUrl !== undefined
            ? typeof body.externalUrl === "string"
              ? body.externalUrl.trim() || null
              : null
            : existing.externalUrl,
        description:
          body.description !== undefined
            ? typeof body.description === "string"
              ? body.description.trim() || null
              : null
            : existing.description,
        tagsJson: tags.length > 0 ? JSON.stringify(tags) : null,
        metadata: nextMetadata ? JSON.stringify(nextMetadata) : null,
        isActive: true,
        isFactRecord:
          body.isFactRecord !== undefined
            ? parseBoolean(body.isFactRecord, existing.isFactRecord)
            : existing.isFactRecord,
        revisionNumber: maxRevision + 1,
        revisionOfId: rootId,
        replacedById: null,
        aiRationale:
          body.aiRationale !== undefined
            ? typeof body.aiRationale === "string"
              ? body.aiRationale.trim() || null
              : null
            : existing.aiRationale,
        datetimeCreated: now,
        datetimeUpdated: now,
      })
      .run();

    await db
      .update(supportingDocuments)
      .set({
        isActive: false,
        replacedById: nextId,
        datetimeUpdated: now,
      })
      .where(eq(supportingDocuments.id, existing.id))
      .run();

    const currentMappings = await loadDocumentMappings(db, [existing.id]);
    await replaceDocumentMappings(db, nextId, {
      roomIds: roomIdsProvided ? roomIds : currentMappings.roomIdsByDoc.get(existing.id) || [],
      scenarioIds: scenarioIdsProvided
        ? scenarioIds
        : currentMappings.scenarioIdsByDoc.get(existing.id) || [],
      visionNodeIds: visionNodeIdsProvided
        ? visionNodeIds
        : currentMappings.nodeIdsByDoc.get(existing.id) || [],
    });

    const createdRevision = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, nextId))
      .get();
    const mappings = await loadDocumentMappings(db, [nextId]);

    return c.json({
      success: true,
      revisionCreated: true,
      document: createdRevision
        ? {
            ...createdRevision,
            tags: parseStringArray(createdRevision.tagsJson),
            roomIds: mappings.roomIdsByDoc.get(nextId) || [],
            roomLabels: mappings.roomLabelsByDoc.get(nextId) || [],
            scenarioIds: mappings.scenarioIdsByDoc.get(nextId) || [],
            scenarioNames: mappings.scenarioNamesByDoc.get(nextId) || [],
            visionNodeIds: mappings.nodeIdsByDoc.get(nextId) || [],
            visionNodeTitles: mappings.nodeTitlesByDoc.get(nextId) || [],
          }
        : null,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update supporting document",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// P2-02 — PATCH /api/supporting-documents/:id/settings
// ---------------------------------------------------------------------------
/**
 * Updates only visibility/docType/tags — distinct from the revision-forking
 * PATCH /:id above so it never triggers `createRevision` semantics. Guarded:
 * this router is intentionally unauthenticated overall (see the file-level
 * comment near improve-description), but write endpoints added in Phase 2
 * (settings, associations, reextract) require the admin access cookie.
 *
 * Body (JSON): { visibility?: "private" | "public", docType?: string | null, tags?: string[] }
 */
supportingDocumentsRouter.patch("/:id/settings", requireAccessAuth, async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const documentId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, documentId))
      .get();
    if (!existing) {
      return c.json({ error: "Supporting document not found" }, 404);
    }

    const updates: Record<string, unknown> = { datetimeUpdated: new Date() };

    if (body.visibility !== undefined) {
      if (body.visibility !== "private" && body.visibility !== "public") {
        return c.json({ error: "visibility must be 'private' or 'public'" }, 400);
      }
      updates.visibility = body.visibility;
    }
    if (body.docType !== undefined) {
      updates.docType = normalizeDocType(body.docType);
    }
    if (body.tags !== undefined) {
      const tags = parseStringArray(body.tags);
      updates.tagsJson = tags.length > 0 ? JSON.stringify(tags) : null;
    }

    await db
      .update(supportingDocuments)
      .set(updates)
      .where(eq(supportingDocuments.id, documentId))
      .run();

    const updated = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, documentId))
      .get();

    return c.json({
      success: true,
      document: updated ? { ...updated, tags: parseStringArray(updated.tagsJson) } : null,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update supporting document settings",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// P2-02 — GET /api/supporting-documents/:id/associations
// ---------------------------------------------------------------------------
/**
 * Lists the generic polymorphic associations for a document. Read-only —
 * follows the router's open-read posture (writes below are guarded). Used by
 * the admin AssociationsDialog to pre-seed its list on open.
 */
supportingDocumentsRouter.get("/:id/associations", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const documentId = c.req.param("id");

    const existing = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, documentId))
      .get();
    if (!existing) {
      return c.json({ error: "Supporting document not found" }, 404);
    }

    const associations = await db
      .select()
      .from(documentEntityAssociations)
      .where(eq(documentEntityAssociations.documentId, documentId))
      .all();

    return c.json({ success: true, associations });
  } catch (error) {
    return c.json(
      {
        error: "Failed to list document associations",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// P2-02 — POST /api/supporting-documents/:id/associations
// ---------------------------------------------------------------------------
/**
 * Adds a generic polymorphic association row (documentEntityAssociations).
 * Body (JSON): { entityType: "company"|"brand"|"product"|"showroom"|"permit"|"floor", entityId: string }
 * Guarded — admin-only write endpoint.
 */
supportingDocumentsRouter.post("/:id/associations", requireAccessAuth, async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const documentId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    const existing = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, documentId))
      .get();
    if (!existing) {
      return c.json({ error: "Supporting document not found" }, 404);
    }

    if (!isValidEntityType(body.entityType)) {
      return c.json(
        { error: `entityType must be one of: ${ENTITY_TYPES.join(", ")}` },
        400,
      );
    }
    const entityId = typeof body.entityId === "string" ? body.entityId.trim() : "";
    if (!entityId) {
      return c.json({ error: "entityId is required" }, 400);
    }

    await db
      .insert(documentEntityAssociations)
      .values({ documentId, entityType: body.entityType, entityId })
      .onConflictDoNothing()
      .run();

    const associations = await db
      .select()
      .from(documentEntityAssociations)
      .where(eq(documentEntityAssociations.documentId, documentId))
      .all();

    return c.json({ success: true, associations }, 201);
  } catch (error) {
    return c.json(
      {
        error: "Failed to add document association",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// P2-02 — DELETE /api/supporting-documents/:id/associations
// ---------------------------------------------------------------------------
/**
 * Removes a generic polymorphic association row.
 * Body (JSON): { entityType, entityId }
 * Guarded — admin-only write endpoint.
 */
supportingDocumentsRouter.delete("/:id/associations", requireAccessAuth, async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const documentId = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

    if (!isValidEntityType(body.entityType)) {
      return c.json(
        { error: `entityType must be one of: ${ENTITY_TYPES.join(", ")}` },
        400,
      );
    }
    const entityId = typeof body.entityId === "string" ? body.entityId.trim() : "";
    if (!entityId) {
      return c.json({ error: "entityId is required" }, 400);
    }

    await db
      .delete(documentEntityAssociations)
      .where(
        and(
          eq(documentEntityAssociations.documentId, documentId),
          eq(documentEntityAssociations.entityType, body.entityType),
          eq(documentEntityAssociations.entityId, entityId),
        ),
      )
      .run();

    const associations = await db
      .select()
      .from(documentEntityAssociations)
      .where(eq(documentEntityAssociations.documentId, documentId))
      .all();

    return c.json({ success: true, associations });
  } catch (error) {
    return c.json(
      {
        error: "Failed to remove document association",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// P2-02 — POST /api/supporting-documents/:id/reextract
// ---------------------------------------------------------------------------
/**
 * Resets extractionStatus to "pending" and re-runs the extraction/embedding
 * pipeline via waitUntil. Guarded — admin-only write endpoint.
 */
supportingDocumentsRouter.post("/:id/reextract", requireAccessAuth, async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const documentId = c.req.param("id");

    const existing = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, documentId))
      .get();
    if (!existing) {
      return c.json({ error: "Supporting document not found" }, 404);
    }

    await db
      .update(supportingDocuments)
      .set({ extractionStatus: "pending", datetimeUpdated: new Date() })
      .where(eq(supportingDocuments.id, documentId))
      .run();

    c.executionCtx.waitUntil(extractAndEmbedDocument(c.env, documentId));

    return c.json({ success: true, documentId, extractionStatus: "pending" });
  } catch (error) {
    return c.json(
      {
        error: "Failed to trigger re-extraction",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

supportingDocumentsRouter.post("/:id/mappings", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const documentId = c.req.param("id");
    const body = (await c.req.json()) as Record<string, unknown>;

    const existing = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, documentId))
      .get();
    if (!existing) {
      return c.json({ error: "Supporting document not found" }, 404);
    }

    const roomIds = parseNumberArray(body.roomIds);
    const scenarioIds = parseStringArray(body.scenarioIds);
    const visionNodeIds = parseStringArray(body.visionNodeIds);

    if (roomIds.length > 0) {
      const roomRows = await db.select().from(rooms).where(inArray(rooms.id, roomIds)).all();
      if (roomRows.length !== roomIds.length) {
        return c.json({ error: "One or more roomIds are invalid" }, 404);
      }
    }
    if (scenarioIds.length > 0) {
      const scenarioRows = await db
        .select()
        .from(remodelScenarios)
        .where(inArray(remodelScenarios.id, scenarioIds))
        .all();
      if (scenarioRows.length !== scenarioIds.length) {
        return c.json({ error: "One or more scenarioIds are invalid" }, 404);
      }
    }
    if (visionNodeIds.length > 0) {
      const nodeRows = await db
        .select()
        .from(visionPlanNodes)
        .where(inArray(visionPlanNodes.id, visionNodeIds))
        .all();
      if (nodeRows.length !== visionNodeIds.length) {
        return c.json({ error: "One or more visionNodeIds are invalid" }, 404);
      }
    }

    await replaceDocumentMappings(db, documentId, {
      roomIds,
      scenarioIds,
      visionNodeIds,
    });

    await db
      .update(supportingDocuments)
      .set({ datetimeUpdated: new Date() })
      .where(eq(supportingDocuments.id, documentId))
      .run();

    const updated = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, documentId))
      .get();
    const mappings = await loadDocumentMappings(db, [documentId]);

    return c.json({
      success: true,
      document: updated
        ? {
            ...updated,
            tags: parseStringArray(updated.tagsJson),
            roomIds: mappings.roomIdsByDoc.get(documentId) || [],
            roomLabels: mappings.roomLabelsByDoc.get(documentId) || [],
            scenarioIds: mappings.scenarioIdsByDoc.get(documentId) || [],
            scenarioNames: mappings.scenarioNamesByDoc.get(documentId) || [],
            visionNodeIds: mappings.nodeIdsByDoc.get(documentId) || [],
            visionNodeTitles: mappings.nodeTitlesByDoc.get(documentId) || [],
          }
        : null,
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to update document mappings",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

supportingDocumentsRouter.get("/:id/history", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const documentId = c.req.param("id");
    const document = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, documentId))
      .get();
    if (!document) {
      return c.json({ error: "Supporting document not found" }, 404);
    }

    const rootId = document.revisionOfId || document.id;
    const rows = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.revisionOfId, rootId))
      .orderBy(desc(supportingDocuments.revisionNumber))
      .all();
    const rootDoc = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, rootId))
      .get();

    const historyRows = [rootDoc, ...rows]
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => b.revisionNumber - a.revisionNumber);
    const mappings = await loadDocumentMappings(
      db,
      historyRows.map((row) => row.id),
    );

    return c.json({
      success: true,
      rootId,
      history: historyRows.map((row) => ({
        ...row,
        tags: parseStringArray(row.tagsJson),
        roomIds: mappings.roomIdsByDoc.get(row.id) || [],
        roomLabels: mappings.roomLabelsByDoc.get(row.id) || [],
        scenarioIds: mappings.scenarioIdsByDoc.get(row.id) || [],
        scenarioNames: mappings.scenarioNamesByDoc.get(row.id) || [],
        visionNodeIds: mappings.nodeIdsByDoc.get(row.id) || [],
        visionNodeTitles: mappings.nodeTitlesByDoc.get(row.id) || [],
      })),
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to load document revision history",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

supportingDocumentsRouter.get("/:id", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const documentId = c.req.param("id");
    const row = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, documentId))
      .get();
    if (!row) {
      return c.json({ error: "Supporting document not found" }, 404);
    }

    const mappings = await loadDocumentMappings(db, [documentId]);
    return c.json({
      success: true,
      document: {
        ...row,
        tags: parseStringArray(row.tagsJson),
        roomIds: mappings.roomIdsByDoc.get(documentId) || [],
        roomLabels: mappings.roomLabelsByDoc.get(documentId) || [],
        scenarioIds: mappings.scenarioIdsByDoc.get(documentId) || [],
        scenarioNames: mappings.scenarioNamesByDoc.get(documentId) || [],
        visionNodeIds: mappings.nodeIdsByDoc.get(documentId) || [],
        visionNodeTitles: mappings.nodeTitlesByDoc.get(documentId) || [],
      },
    });
  } catch (error) {
    return c.json(
      {
        error: "Failed to fetch supporting document",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// T6.1 — POST /api/supporting-documents/improve-description
// ---------------------------------------------------------------------------
/**
 * Improves a user-supplied description using Workers AI (the ✨ button in the
 * supporting-document upload intake form).
 *
 * Lives on this public, browser-reachable router rather than aiRouter, which is
 * Bearer-gated for server-to-server callers; the browser only holds the access
 * cookie. Mirrors the auth posture of the sibling room-summary route below.
 *
 * Body (JSON): { text: string (1–3000 chars, required), context?: string (<=200) }
 * Response: { success, original, improved }
 */
supportingDocumentsRouter.post("/improve-description", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { text?: string; context?: string };
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return c.json({ error: { code: "BAD_REQUEST", message: "text is required" } }, 400);
  }
  if (text.length > 3_000) {
    return c.json({ error: { code: "BAD_REQUEST", message: "text exceeds 3000 chars" } }, 400);
  }
  const context = typeof body.context === "string" ? body.context.slice(0, 200) : undefined;
  try {
    const improved = await improveDescription(c.env, text, context);
    return c.json({ success: true, original: text, improved });
  } catch (error) {
    return c.json(
      {
        error: { code: "AI_ERROR", message: "Failed to improve description" },
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

// ---------------------------------------------------------------------------
// T6.1 — POST /api/supporting-documents/:id/room-summary
// ---------------------------------------------------------------------------

/**
 * Generates an AI-powered room-tailored summary for a supporting document,
 * then caches the result into `supporting_documents.aiRationale`.
 *
 * The frontend calls this lazily on load for each document row that has no
 * cached summary yet (aiRationale is null or empty).
 *
 * Path param: id — UUID of the supporting document
 * Body (JSON, optional):
 *   roomId   — integer   (optional if the document already has a single room mapping)
 *   roomCode — string    (optional, used for context if roomId is omitted)
 *   roomName — string    (optional override)
 *   force    — boolean   (default false) — regenerate even when aiRationale already set
 *
 * Response: { success, documentId, aiRationale, cached }
 */
supportingDocumentsRouter.post("/:id/room-summary", async (c) => {
  try {
    const db = drizzle(c.env.DB);
    const documentId = c.req.param("id");

    const doc = await db
      .select()
      .from(supportingDocuments)
      .where(eq(supportingDocuments.id, documentId))
      .get();

    if (!doc) {
      return c.json(
        { error: { code: "NOT_FOUND", message: "Supporting document not found" } },
        404,
      );
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      roomId?: number;
      roomCode?: string;
      roomName?: string;
      force?: boolean;
    };

    // Return cached value unless force=true
    if (doc.aiRationale && !body.force) {
      return c.json({
        success: true,
        documentId,
        aiRationale: doc.aiRationale,
        cached: true,
      });
    }

    // Resolve the room context: explicit roomId > mapped rooms > fallback labels
    let roomContext = {
      roomName: body.roomName?.trim() || "the room",
      roomCode: body.roomCode?.trim() || "unknown",
    };

    if (body.roomId) {
      const room = await db
        .select({ roomName: rooms.roomName, roomCode: rooms.roomCode })
        .from(rooms)
        .where(eq(rooms.id, body.roomId))
        .get();
      if (room) {
        roomContext = { roomName: room.roomName, roomCode: room.roomCode };
      }
    } else {
      // Fall back to first mapped room
      const mapping = await db
        .select({ roomId: supportingDocumentRoomMappings.roomId })
        .from(supportingDocumentRoomMappings)
        .where(eq(supportingDocumentRoomMappings.supportingDocumentId, documentId))
        .get();
      if (mapping) {
        const room = await db
          .select({ roomName: rooms.roomName, roomCode: rooms.roomCode })
          .from(rooms)
          .where(eq(rooms.id, mapping.roomId))
          .get();
        if (room) {
          roomContext = { roomName: room.roomName, roomCode: room.roomCode };
        }
      }
    }

    const aiRationale = await summarizeDocumentForRoom(
      c.env,
      {
        title: doc.title,
        description: doc.description,
        sourceType: doc.sourceType,
        externalUrl: doc.externalUrl,
      },
      roomContext,
    );

    // Cache the result into aiRationale column (fire-and-forget is unsafe — await it)
    if (aiRationale) {
      await db
        .update(supportingDocuments)
        .set({ aiRationale, datetimeUpdated: new Date() })
        .where(eq(supportingDocuments.id, documentId))
        .run();
    }

    return c.json({
      success: true,
      documentId,
      aiRationale: aiRationale || null,
      cached: false,
    });
  } catch (error) {
    return c.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to generate document room summary",
        },
        details: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});

export { supportingDocumentsRouter };
