/**
 * @fileoverview Workshop API (0014 Slice 1) — `/api/workshop`.
 *
 * The Workshop is a room-scoped infinite-canvas "sample table"
 * (docs/0014_ai_photo_workshop/IMPLEMENTATION_PLAN_v2.md §"Front door"). Every
 * room gets exactly one `workstation_boards` row (Slice-1 policy); the board
 * holds free-floating `board_nodes` seeded ONLY from blank-canvas artifacts
 * (photos, canvases, clippings, renders — see the seeding-policy note on
 * GET /rooms/:roomId/board), `photo_collections` side-rail piles, and the
 * room's `sample_clippings` "drawer" (room-scoped + globally-promoted rows).
 * Listing photos and inspiration photos are NOT board nodes — they surface as
 * two additional non-persisted drawer arrays (`listingPhotos`,
 * `inspirationPhotos`) on the board response, for the client to render as
 * separate drawers.
 *
 * Endpoints:
 *   GET    /rooms/:roomId/board                    get-or-create + seed a room's board
 *   POST   /boards/:boardId/nodes                   add a node
 *   PATCH  /nodes/:id                               update node transform/visibility
 *   DELETE /nodes/:id                                remove a node
 *   POST   /boards/:boardId/collections              create a pile
 *   PATCH  /collections/:id                          rename / redock a pile
 *   DELETE /collections/:id                          delete a pile
 *   POST   /collections/:id/items                    add a photo to a pile
 *   DELETE /collections/:id/items/:itemId             remove a photo from a pile
 *   POST   /clippings/extract                         extract a reusable clipping
 *   PATCH  /clippings/:id                             rename / promote-demote global drawer
 *   POST   /nodes/:id/recipe                          run extract|material-swap|mix|clay-to-photoreal|floor-plan-furnish|tone-unify|lighting-enhance on a node
 *
 * All routes are mounted behind `requireAccessAuth` (see api/index.ts). Every
 * multi-row write goes through `db.batch` (D1 has no interactive transactions).
 */
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import {
  boardNodes,
  furnishingItems,
  photoCollectionItems,
  photoCollections,
  renderSessions,
  rooms,
  sampleClippings,
  workstationBoards,
} from "@backend/db";

import { cropAndUploadCfImage, probeCfImageDimensions } from "../../services/render/cf-images";
import { nearestAspectRatio } from "../../services/render/prompt-kit";
import { RECIPES, buildRecipePrompt } from "../../services/render/recipes";
import { runStage } from "../../services/render/stage-runner";
import { extractFurnishings } from "../../services/workshop/furnishing-extraction";
import {
  resolveFloorPlanDrawer,
  resolveInspirationDrawer,
  resolveListingPhotoDrawer,
  resolveRenderDrawer,
  resolveRoomArtifactSeeds,
} from "../../services/workshop/room-context";

export const workshopRouter = new OpenAPIHono<{ Bindings: Env }>();

// ─────────────────────────────────────────────────────────────────────────────
// Shared schemas
// ─────────────────────────────────────────────────────────────────────────────

const ErrorSchema = z.object({ error: z.string() });

const SOURCE_TYPES = [
  "listing_photo",
  "blank_canvas",
  "inspiration",
  "clipping",
  "render",
  "floor_plan",
] as const;

// Node kinds: "image" is the original Slice-1 kind; rectangle/ellipse/text/pen
// are the devl.dev vector-shape template-parity kinds (frontend, appended
// contract widening) — persisted as board_nodes with their visual props in
// the metadata JSON bag (fill/opacity/text?/points?/name). note/group remain
// reserved for future free-text annotation and node-grouping.
const NODE_KINDS = ["image", "note", "group", "rectangle", "ellipse", "text", "pen"] as const;

const BoardNodeSchema = z.object({
  id: z.string(),
  boardId: z.string(),
  kind: z.enum(NODE_KINDS),
  cfImageUrl: z.string(),
  sourceType: z.enum(SOURCE_TYPES),
  sourceId: z.string().nullable(),
  renderCanvasId: z.string().nullable(),
  parentNodeId: z.string().nullable(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
  zIndex: z.number(),
  isVisible: z.boolean(),
  isLocked: z.boolean(),
  metadata: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const CollectionItemSchema = z.object({
  id: z.number(),
  cfImageUrl: z.string(),
  sourceType: z.enum(SOURCE_TYPES),
  sourceId: z.string().nullable(),
  sortOrder: z.number(),
});

const CollectionSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  dockSlot: z.number(),
  items: z.array(CollectionItemSchema),
});

const ClippingSchema = z.object({
  id: z.string(),
  roomId: z.number().nullable(),
  sourceCfImageUrl: z.string(),
  clippingCfImageUrl: z.string(),
  label: z.string().nullable(),
  bboxJson: z.string().nullable(),
  renderCanvasId: z.string().nullable(),
  isGlobal: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const BboxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

/** A drawer entry — a listing/inspiration photo NOT seeded as a board node. */
const DrawerPhotoSchema = z.object({
  sourceId: z.string(),
  cfImageUrl: z.string(),
  label: z.string().nullable(),
});

/** Row -> wire shape: epoch-ms timestamps, boolean coercion. */
function serializeNode(row: typeof boardNodes.$inferSelect) {
  return {
    id: row.id,
    boardId: row.boardId,
    kind: row.kind,
    cfImageUrl: row.cfImageUrl,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    renderCanvasId: row.renderCanvasId,
    parentNodeId: row.parentNodeId,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    zIndex: row.zIndex,
    isVisible: row.isVisible,
    isLocked: row.isLocked,
    metadata: row.metadata,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

function serializeClipping(row: typeof sampleClippings.$inferSelect) {
  return {
    id: row.id,
    roomId: row.roomId,
    sourceCfImageUrl: row.sourceCfImageUrl,
    clippingCfImageUrl: row.clippingCfImageUrl,
    label: row.label,
    bboxJson: row.bboxJson,
    renderCanvasId: row.renderCanvasId,
    isGlobal: row.isGlobal,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

async function loadCollectionWithItems(env: Env, collectionId: string) {
  const db = drizzle(env.DB);
  const collection = await db
    .select()
    .from(photoCollections)
    .where(eq(photoCollections.id, collectionId))
    .get();
  if (!collection) return null;
  const items = await db
    .select()
    .from(photoCollectionItems)
    .where(eq(photoCollectionItems.collectionId, collectionId))
    .orderBy(photoCollectionItems.sortOrder)
    .all();
  return {
    id: collection.id,
    name: collection.name,
    dockSlot: collection.dockSlot,
    items: items.map((item) => ({
      id: item.id,
      cfImageUrl: item.cfImageUrl,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      sortOrder: item.sortOrder,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /rooms/:roomId/board — get-or-create + seed
// ─────────────────────────────────────────────────────────────────────────────

workshopRouter.openapi(
  createRoute({
    method: "get",
    path: "/rooms/{roomId}/board",
    request: { params: z.object({ roomId: z.coerce.number().int() }) },
    responses: {
      200: {
        description: "The room's board, seeded on first load",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              board: z.object({ id: z.string(), roomId: z.number(), name: z.string().nullable() }),
              nodes: z.array(BoardNodeSchema),
              collections: z.array(CollectionSchema),
              clippings: z.array(ClippingSchema),
              listingPhotos: z.array(DrawerPhotoSchema),
              inspirationPhotos: z.array(DrawerPhotoSchema),
              renderPhotos: z.array(DrawerPhotoSchema),
              floorPlanPhotos: z.array(DrawerPhotoSchema),
            }),
          },
        },
      },
      404: { description: "Room not found", content: { "application/json": { schema: ErrorSchema } } },
      500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
    },
    tags: ["workshop"],
    summary: "Get or create a room's Workshop board (seeds nodes on first create)",
    operationId: "getOrCreateRoomBoard",
  }),
  async (c) => {
    try {
      const { roomId } = c.req.valid("param");
      const db = drizzle(c.env.DB);

      const room = await db.select().from(rooms).where(eq(rooms.id, roomId)).get();
      if (!room) return c.json({ error: "Room not found" }, 404);

      let board = await db
        .select()
        .from(workstationBoards)
        .where(eq(workstationBoards.roomId, roomId))
        .get();

      let seeded = false;
      if (!board) {
        const boardId = crypto.randomUUID();
        await db
          .insert(workstationBoards)
          .values({ id: boardId, roomId, name: room.roomName })
          .run();
        board = await db.select().from(workstationBoards).where(eq(workstationBoards.id, boardId)).get();
        seeded = true;
      }
      if (!board) return c.json({ error: "Failed to create board" }, 500);

      if (seeded) {
        // Slice-1 seeding policy: ONLY blank-canvas artifacts get seeded as
        // board_nodes — that's what actually gets decorated. Listing +
        // inspiration photos are drawer-only (see listingPhotos/inspirationPhotos
        // below) and are never written to board_nodes at seed time.
        const seeds = await resolveRoomArtifactSeeds(c.env, roomId);
        if (seeds.length > 0) {
          const COLS = 4;
          const statements = seeds.map((seed, index) => {
            const col = index % COLS;
            const row = Math.floor(index / COLS);
            return db.insert(boardNodes).values({
              id: crypto.randomUUID(),
              boardId: board!.id,
              kind: "image" as const,
              cfImageUrl: seed.cfImageUrl,
              sourceType: seed.sourceType,
              sourceId: seed.sourceId,
              x: col * 360,
              y: row * 300,
            });
          });
          await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);
        }
      }

      let nodes = await db
        .select()
        .from(boardNodes)
        .where(eq(boardNodes.boardId, board.id))
        .orderBy(boardNodes.zIndex)
        .all();

      // ---- Slice-1 seeding-policy migration (lazy, one-time cleanup) ----
      // Boards created before this policy landed have listing_photo/inspiration
      // nodes seeded directly on the canvas. Delete any node matching the
      // "original seed" signature — sourceType IN ('listing_photo','inspiration')
      // AND parentNodeId IS NULL (no on-board lineage) AND renderCanvasId IS NULL
      // (never touched the render pipeline) — and exclude them from the
      // response. This intentionally leaves clipping/render nodes and anything
      // with lineage untouched.
      //
      // Caveat: a node the user deliberately drags onto the canvas from a
      // drawer LATER will also match this signature (fresh drop = no parent,
      // no render lineage) and would get swept up by a later board load. To
      // prevent that, POST /boards/:boardId/nodes stamps
      // metadata = '{"placed":true}' whenever sourceType is listing_photo or
      // inspiration, and this cleanup exempts any node whose metadata parses
      // to { placed: true }.
      //
      // Vector shape nodes (rectangle/ellipse/text/pen — the devl.dev
      // template-parity tools) send sourceType "blank_canvas" (see
      // src/frontend/components/workshop/api.ts createShapeNode), so the
      // sourceType check below already excludes them from this cleanup with
      // no further change needed.
      const staleSeedNodes = nodes.filter((node) => {
        if (node.sourceType !== "listing_photo" && node.sourceType !== "inspiration") return false;
        if (node.parentNodeId !== null || node.renderCanvasId !== null) return false;
        if (node.metadata) {
          try {
            const parsed = JSON.parse(node.metadata) as { placed?: boolean };
            if (parsed?.placed === true) return false;
          } catch {
            // Unparseable metadata — treat as not-placed, fall through to cleanup.
          }
        }
        return true;
      });

      if (staleSeedNodes.length > 0) {
        const staleIds = new Set(staleSeedNodes.map((node) => node.id));
        const deleteStatements = staleSeedNodes.map((node) => db.delete(boardNodes).where(eq(boardNodes.id, node.id)));
        await db.batch(deleteStatements as [(typeof deleteStatements)[number], ...(typeof deleteStatements)[number][]]);
        nodes = nodes.filter((node) => !staleIds.has(node.id));
      }

      const [collections, clippings, listingPhotos, inspirationPhotos, renderPhotos] =
        await Promise.all([
          db.select().from(photoCollections).where(eq(photoCollections.boardId, board.id)).all(),
          // Clippings visibility: room-scoped OR promoted to the global drawer.
          db
            .select()
            .from(sampleClippings)
            .where(or(eq(sampleClippings.roomId, roomId), eq(sampleClippings.isGlobal, true)))
            .all(),
          resolveListingPhotoDrawer(c.env, roomId),
          resolveInspirationDrawer(c.env, roomId),
          resolveRenderDrawer(c.env, roomId),
        ]);

      const collectionsWithItems = await Promise.all(
        collections.map(async (collection) => {
          const items = await db
            .select()
            .from(photoCollectionItems)
            .where(eq(photoCollectionItems.collectionId, collection.id))
            .orderBy(photoCollectionItems.sortOrder)
            .all();
          return {
            id: collection.id,
            name: collection.name,
            dockSlot: collection.dockSlot,
            items: items.map((item) => ({
              id: item.id,
              cfImageUrl: item.cfImageUrl,
              sourceType: item.sourceType,
              sourceId: item.sourceId,
              sortOrder: item.sortOrder,
            })),
          };
        }),
      );

      const floorPlanPhotos = await resolveFloorPlanDrawer(
        c.env,
        roomId,
        new URL(c.req.url).origin,
      );

      return c.json(
        {
          success: true as const,
          board: { id: board.id, roomId: board.roomId, name: board.name },
          nodes: nodes.map(serializeNode),
          collections: collectionsWithItems,
          clippings: clippings.map(serializeClipping),
          listingPhotos,
          inspirationPhotos,
          renderPhotos,
          floorPlanPhotos,
        },
        200,
      );
    } catch (err) {
      console.error("[workshop] GET /rooms/:roomId/board failed:", err);
      return c.json({ error: "Failed to load board" }, 500);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /boards/:boardId/nodes
// ─────────────────────────────────────────────────────────────────────────────

const CreateNodeSchema = z.object({
  // "image" is the original Slice-1 node kind; rectangle/ellipse/text/pen are
  // the devl.dev vector-shape template-parity kinds — their visual props
  // (fill/opacity/text?/points?/name) travel in `metadata` as a JSON string.
  kind: z.enum(NODE_KINDS),
  // cfImageUrl stays NOT NULL / z.url() — shape nodes send the "about:shape"
  // sentinel (a valid WHATWG URL) since they have no backing image.
  cfImageUrl: z.url(),
  sourceType: z.enum(SOURCE_TYPES),
  sourceId: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  parentNodeId: z.string().optional(),
  renderCanvasId: z.string().optional(),
  // JSON string bag: shape visual props ({fill, opacity, text?, points?, name})
  // for rectangle/ellipse/text/pen kinds. Optional/unused for "image".
  metadata: z.string().optional(),
});

workshopRouter.openapi(
  createRoute({
    method: "post",
    path: "/boards/{boardId}/nodes",
    request: {
      params: z.object({ boardId: z.string() }),
      body: { content: { "application/json": { schema: CreateNodeSchema } } },
    },
    responses: {
      201: {
        description: "Node created",
        content: { "application/json": { schema: z.object({ success: z.literal(true), node: BoardNodeSchema }) } },
      },
      404: { description: "Board not found", content: { "application/json": { schema: ErrorSchema } } },
      500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
    },
    tags: ["workshop"],
    summary: "Add an image node to a board",
    operationId: "createBoardNode",
  }),
  async (c) => {
    try {
      const { boardId } = c.req.valid("param");
      const body = c.req.valid("json");
      const db = drizzle(c.env.DB);

      const board = await db.select().from(workstationBoards).where(eq(workstationBoards.id, boardId)).get();
      if (!board) return c.json({ error: "Board not found" }, 404);

      // Nodes placed on the canvas from a drawer (listing_photo / inspiration)
      // must be exempted from the lazy Slice-1 seeding-policy cleanup in
      // GET /rooms/:roomId/board — that cleanup sweeps any parentless,
      // render-lineage-free node of these sourceTypes as a stale pre-policy
      // seed, and a user-placed drawer drop would otherwise match the same
      // signature. Stamping metadata = {placed:true} here is how the cleanup
      // tells the two apart. Shape nodes (rectangle/ellipse/text/pen) send
      // their own metadata JSON bag (fill/opacity/text?/points?/name) — the
      // stamp MERGES into that object rather than clobbering it; malformed
      // client JSON falls back to just the stamp (or null when no stamp
      // applies and metadata doesn't parse).
      const id = crypto.randomUUID();
      const needsPlacedStamp = body.sourceType === "listing_photo" || body.sourceType === "inspiration";
      let metadata: string | null = body.metadata ?? null;
      if (needsPlacedStamp) {
        let base: Record<string, unknown> = {};
        if (body.metadata) {
          try {
            const parsed = JSON.parse(body.metadata) as unknown;
            if (parsed && typeof parsed === "object") base = parsed as Record<string, unknown>;
          } catch {
            // Malformed client metadata — drop it, keep just the stamp.
          }
        }
        metadata = JSON.stringify({ ...base, placed: true });
      }
      await db
        .insert(boardNodes)
        .values({
          id,
          boardId,
          kind: body.kind,
          cfImageUrl: body.cfImageUrl,
          sourceType: body.sourceType,
          sourceId: body.sourceId ?? null,
          renderCanvasId: body.renderCanvasId ?? null,
          parentNodeId: body.parentNodeId ?? null,
          metadata,
          x: body.x ?? 0,
          y: body.y ?? 0,
          width: body.width ?? 320,
          height: body.height ?? 240,
        })
        .run();

      const node = await db.select().from(boardNodes).where(eq(boardNodes.id, id)).get();
      if (!node) return c.json({ error: "Failed to create node" }, 500);
      return c.json({ success: true as const, node: serializeNode(node) }, 201);
    } catch (err) {
      console.error("[workshop] POST /boards/:boardId/nodes failed:", err);
      return c.json({ error: "Failed to create node" }, 500);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /nodes/:id
// ─────────────────────────────────────────────────────────────────────────────

const PatchNodeSchema = z.object({
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),
  zIndex: z.number().optional(),
  isVisible: z.boolean().optional(),
  isLocked: z.boolean().optional(),
  // JSON string bag — persists shape fill/opacity/text edits (and any other
  // metadata rewrite) for rectangle/ellipse/text/pen nodes.
  metadata: z.string().optional(),
});

workshopRouter.openapi(
  createRoute({
    method: "patch",
    path: "/nodes/{id}",
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { "application/json": { schema: PatchNodeSchema } } },
    },
    responses: {
      200: {
        description: "Node updated",
        content: { "application/json": { schema: z.object({ success: z.literal(true), node: BoardNodeSchema }) } },
      },
      404: { description: "Node not found", content: { "application/json": { schema: ErrorSchema } } },
      500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
    },
    tags: ["workshop"],
    summary: "Update a node's canvas transform / visibility / lock state",
    operationId: "patchBoardNode",
  }),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const db = drizzle(c.env.DB);

      const existing = await db.select().from(boardNodes).where(eq(boardNodes.id, id)).get();
      if (!existing) return c.json({ error: "Node not found" }, 404);

      await db
        .update(boardNodes)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(boardNodes.id, id))
        .run();

      const node = await db.select().from(boardNodes).where(eq(boardNodes.id, id)).get();
      if (!node) return c.json({ error: "Node not found" }, 404);
      return c.json({ success: true as const, node: serializeNode(node) }, 200);
    } catch (err) {
      console.error("[workshop] PATCH /nodes/:id failed:", err);
      return c.json({ error: "Failed to update node" }, 500);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /nodes/:id
// ─────────────────────────────────────────────────────────────────────────────

workshopRouter.openapi(
  createRoute({
    method: "delete",
    path: "/nodes/{id}",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: "Node deleted",
        content: { "application/json": { schema: z.object({ success: z.literal(true) }) } },
      },
      404: { description: "Node not found", content: { "application/json": { schema: ErrorSchema } } },
      500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
    },
    tags: ["workshop"],
    summary: "Remove a node from a board",
    operationId: "deleteBoardNode",
  }),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const db = drizzle(c.env.DB);
      const existing = await db.select().from(boardNodes).where(eq(boardNodes.id, id)).get();
      if (!existing) return c.json({ error: "Node not found" }, 404);
      await db.delete(boardNodes).where(eq(boardNodes.id, id)).run();
      return c.json({ success: true as const }, 200);
    } catch (err) {
      console.error("[workshop] DELETE /nodes/:id failed:", err);
      return c.json({ error: "Failed to delete node" }, 500);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Piles — /boards/:boardId/collections, /collections/:id, /collections/:id/items
// ─────────────────────────────────────────────────────────────────────────────

workshopRouter.openapi(
  createRoute({
    method: "post",
    path: "/boards/{boardId}/collections",
    request: {
      params: z.object({ boardId: z.string() }),
      body: { content: { "application/json": { schema: z.object({ name: z.string().min(1).optional() }) } } },
    },
    responses: {
      201: {
        description: "Pile created",
        content: {
          "application/json": { schema: z.object({ success: z.literal(true), collection: CollectionSchema }) },
        },
      },
      404: { description: "Board not found", content: { "application/json": { schema: ErrorSchema } } },
      500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
    },
    tags: ["workshop"],
    summary: "Create a pile (photo_collections) — naming is optional",
    operationId: "createPhotoCollection",
  }),
  async (c) => {
    try {
      const { boardId } = c.req.valid("param");
      const body = c.req.valid("json");
      const db = drizzle(c.env.DB);

      const board = await db.select().from(workstationBoards).where(eq(workstationBoards.id, boardId)).get();
      if (!board) return c.json({ error: "Board not found" }, 404);

      const existing = await db
        .select()
        .from(photoCollections)
        .where(eq(photoCollections.boardId, boardId))
        .all();
      const nextDockSlot = existing.length;

      const id = crypto.randomUUID();
      await db
        .insert(photoCollections)
        .values({ id, boardId, name: body.name ?? null, dockSlot: nextDockSlot })
        .run();

      const collection = await loadCollectionWithItems(c.env, id);
      if (!collection) return c.json({ error: "Failed to create pile" }, 500);
      return c.json({ success: true as const, collection }, 201);
    } catch (err) {
      console.error("[workshop] POST /boards/:boardId/collections failed:", err);
      return c.json({ error: "Failed to create pile" }, 500);
    }
  },
);

workshopRouter.openapi(
  createRoute({
    method: "patch",
    path: "/collections/{id}",
    request: {
      params: z.object({ id: z.string() }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ name: z.string().min(1).nullable().optional(), dockSlot: z.number().optional() }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Pile updated",
        content: {
          "application/json": { schema: z.object({ success: z.literal(true), collection: CollectionSchema }) },
        },
      },
      404: { description: "Pile not found", content: { "application/json": { schema: ErrorSchema } } },
      500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
    },
    tags: ["workshop"],
    summary: "Rename or redock a pile",
    operationId: "patchPhotoCollection",
  }),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const db = drizzle(c.env.DB);

      const existing = await db.select().from(photoCollections).where(eq(photoCollections.id, id)).get();
      if (!existing) return c.json({ error: "Pile not found" }, 404);

      await db
        .update(photoCollections)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(photoCollections.id, id))
        .run();

      const collection = await loadCollectionWithItems(c.env, id);
      if (!collection) return c.json({ error: "Pile not found" }, 404);
      return c.json({ success: true as const, collection }, 200);
    } catch (err) {
      console.error("[workshop] PATCH /collections/:id failed:", err);
      return c.json({ error: "Failed to update pile" }, 500);
    }
  },
);

workshopRouter.openapi(
  createRoute({
    method: "delete",
    path: "/collections/{id}",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: "Pile deleted",
        content: { "application/json": { schema: z.object({ success: z.literal(true) }) } },
      },
      404: { description: "Pile not found", content: { "application/json": { schema: ErrorSchema } } },
      500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
    },
    tags: ["workshop"],
    summary: "Delete a pile (cascades its items)",
    operationId: "deletePhotoCollection",
  }),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const db = drizzle(c.env.DB);
      const existing = await db.select().from(photoCollections).where(eq(photoCollections.id, id)).get();
      if (!existing) return c.json({ error: "Pile not found" }, 404);
      await db.delete(photoCollections).where(eq(photoCollections.id, id)).run();
      return c.json({ success: true as const }, 200);
    } catch (err) {
      console.error("[workshop] DELETE /collections/:id failed:", err);
      return c.json({ error: "Failed to delete pile" }, 500);
    }
  },
);

const CollectionItemInputSchema = z.object({
  cfImageUrl: z.url(),
  sourceType: z.enum(SOURCE_TYPES),
  sourceId: z.string().optional(),
});

workshopRouter.openapi(
  createRoute({
    method: "post",
    path: "/collections/{id}/items",
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { "application/json": { schema: CollectionItemInputSchema } } },
    },
    responses: {
      201: {
        description: "Item added (or already present) — full refreshed item list",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), items: z.array(CollectionItemSchema) }),
          },
        },
      },
      404: { description: "Pile not found", content: { "application/json": { schema: ErrorSchema } } },
      500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
    },
    tags: ["workshop"],
    summary: "Add a photo to a pile (no-op if already a member)",
    operationId: "addPhotoCollectionItem",
  }),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const db = drizzle(c.env.DB);

      const collection = await db.select().from(photoCollections).where(eq(photoCollections.id, id)).get();
      if (!collection) return c.json({ error: "Pile not found" }, 404);

      const existing = await db
        .select()
        .from(photoCollectionItems)
        .where(eq(photoCollectionItems.collectionId, id))
        .all();
      const nextSortOrder = existing.length;

      await db
        .insert(photoCollectionItems)
        .values({
          collectionId: id,
          cfImageUrl: body.cfImageUrl,
          sourceType: body.sourceType,
          sourceId: body.sourceId ?? null,
          sortOrder: nextSortOrder,
        })
        .onConflictDoNothing()
        .run();

      const items = await db
        .select()
        .from(photoCollectionItems)
        .where(eq(photoCollectionItems.collectionId, id))
        .orderBy(photoCollectionItems.sortOrder)
        .all();

      return c.json(
        {
          success: true as const,
          items: items.map((item) => ({
            id: item.id,
            cfImageUrl: item.cfImageUrl,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            sortOrder: item.sortOrder,
          })),
        },
        201,
      );
    } catch (err) {
      console.error("[workshop] POST /collections/:id/items failed:", err);
      return c.json({ error: "Failed to add item to pile" }, 500);
    }
  },
);

workshopRouter.openapi(
  createRoute({
    method: "delete",
    path: "/collections/{id}/items/{itemId}",
    request: { params: z.object({ id: z.string(), itemId: z.coerce.number().int() }) },
    responses: {
      200: {
        description: "Item removed — full refreshed item list",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), items: z.array(CollectionItemSchema) }),
          },
        },
      },
      404: { description: "Pile not found", content: { "application/json": { schema: ErrorSchema } } },
      500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
    },
    tags: ["workshop"],
    summary: "Remove a photo from a pile",
    operationId: "removePhotoCollectionItem",
  }),
  async (c) => {
    try {
      const { id, itemId } = c.req.valid("param");
      const db = drizzle(c.env.DB);

      const collection = await db.select().from(photoCollections).where(eq(photoCollections.id, id)).get();
      if (!collection) return c.json({ error: "Pile not found" }, 404);

      await db
        .delete(photoCollectionItems)
        .where(and(eq(photoCollectionItems.id, itemId), eq(photoCollectionItems.collectionId, id)))
        .run();

      const items = await db
        .select()
        .from(photoCollectionItems)
        .where(eq(photoCollectionItems.collectionId, id))
        .orderBy(photoCollectionItems.sortOrder)
        .all();

      return c.json(
        {
          success: true as const,
          items: items.map((item) => ({
            id: item.id,
            cfImageUrl: item.cfImageUrl,
            sourceType: item.sourceType,
            sourceId: item.sourceId,
            sortOrder: item.sortOrder,
          })),
        },
        200,
      );
    } catch (err) {
      console.error("[workshop] DELETE /collections/:id/items/:itemId failed:", err);
      return c.json({ error: "Failed to remove item from pile" }, 500);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /clippings/extract — Slice-1 extraction: CF Images transform crop only.
// (stage_0_IP_extraction refinement is unwired anywhere in the codebase today;
// deferred — see report.)
// ─────────────────────────────────────────────────────────────────────────────

const ExtractClippingSchema = z.object({
  roomId: z.number().int(),
  sourceCfImageUrl: z.url(),
  bbox: BboxSchema,
  label: z.string().min(1).optional(),
  // Global drawer: promote this clipping for use in every room's Workshop
  // (e.g. a paint color chosen house-wide). roomId is still recorded for
  // provenance. Defaults to false — most extractions stay room-scoped.
  isGlobal: z.boolean().optional(),
});

async function extractClipping(
  env: Env,
  input: z.infer<typeof ExtractClippingSchema>,
): Promise<typeof sampleClippings.$inferSelect> {
  const db = drizzle(env.DB);
  const cropped = await cropAndUploadCfImage(env, input.sourceCfImageUrl, input.bbox, "clipping.jpg");

  const id = crypto.randomUUID();
  await db
    .insert(sampleClippings)
    .values({
      id,
      roomId: input.roomId,
      sourceCfImageUrl: input.sourceCfImageUrl,
      clippingCfImageUrl: cropped.deliveryUrl,
      label: input.label ?? null,
      bboxJson: JSON.stringify(input.bbox),
      renderCanvasId: null,
      isGlobal: input.isGlobal ?? false,
    })
    .run();

  const row = await db.select().from(sampleClippings).where(eq(sampleClippings.id, id)).get();
  if (!row) throw new Error("Failed to persist clipping");
  return row;
}

workshopRouter.openapi(
  createRoute({
    method: "post",
    path: "/clippings/extract",
    request: { body: { content: { "application/json": { schema: ExtractClippingSchema } } } },
    responses: {
      201: {
        description: "Clipping extracted and saved to the drawer",
        content: { "application/json": { schema: z.object({ success: z.literal(true), clipping: ClippingSchema }) } },
      },
      400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
      500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
    },
    tags: ["workshop"],
    summary: "Extract a reusable clipping via CF Images transform crop",
    operationId: "extractClipping",
  }),
  async (c) => {
    try {
      const body = c.req.valid("json");
      const clipping = await extractClipping(c.env, body);
      return c.json({ success: true as const, clipping: serializeClipping(clipping) }, 201);
    } catch (err) {
      console.error("[workshop] POST /clippings/extract failed:", err);
      return c.json({ error: "Failed to extract clipping" }, 500);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /clippings/:id — promote/demote the global drawer, rename
// ─────────────────────────────────────────────────────────────────────────────

const PatchClippingSchema = z.object({
  isGlobal: z.boolean().optional(),
  label: z.string().min(1).optional(),
});

workshopRouter.openapi(
  createRoute({
    method: "patch",
    path: "/clippings/{id}",
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { "application/json": { schema: PatchClippingSchema } } },
    },
    responses: {
      200: {
        description: "Clipping updated",
        content: { "application/json": { schema: z.object({ success: z.literal(true), clipping: ClippingSchema }) } },
      },
      404: { description: "Clipping not found", content: { "application/json": { schema: ErrorSchema } } },
      500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
    },
    tags: ["workshop"],
    summary: "Promote/demote a clipping to the global drawer, or rename it",
    operationId: "patchClipping",
  }),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const db = drizzle(c.env.DB);

      const existing = await db.select().from(sampleClippings).where(eq(sampleClippings.id, id)).get();
      if (!existing) return c.json({ error: "Clipping not found" }, 404);

      await db
        .update(sampleClippings)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(sampleClippings.id, id))
        .run();

      const clipping = await db.select().from(sampleClippings).where(eq(sampleClippings.id, id)).get();
      if (!clipping) return c.json({ error: "Clipping not found" }, 404);
      return c.json({ success: true as const, clipping: serializeClipping(clipping) }, 200);
    } catch (err) {
      console.error("[workshop] PATCH /clippings/:id failed:", err);
      return c.json({ error: "Failed to update clipping" }, 500);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /nodes/:id/recipe — extract | material-swap | mix | clay-to-photoreal | floor-plan-furnish | tone-unify | lighting-enhance | plan-to-isometric | evolution-grid
// ─────────────────────────────────────────────────────────────────────────────

const RecipeExtractParams = z.object({
  bbox: BboxSchema,
  label: z.string().min(1).optional(),
  isGlobal: z.boolean().optional(),
});
const RecipeMaterialSwapParams = z.object({
  referenceCfImageUrls: z.array(z.url()).min(1).max(10),
  prompt: z.string().min(1).optional(),
});
const RecipeMixParams = z.object({
  clippingIds: z.array(z.string()).min(1).max(10),
  prompt: z.string().min(1).optional(),
});

const RecipeClayParams = z.object({
  referenceCfImageUrls: z.array(z.url()).max(3).optional(),
  prompt: z.string().min(1).optional(),
});
/** Params for recipes that take no references — only an optional prompt override. */
const RecipePromptOnlyParams = z.object({
  prompt: z.string().min(1).optional(),
});

const RecipeRequestSchema = z.discriminatedUnion("recipe", [
  z.object({ recipe: z.literal("extract"), params: RecipeExtractParams }),
  z.object({ recipe: z.literal("material-swap"), params: RecipeMaterialSwapParams }),
  z.object({ recipe: z.literal("mix"), params: RecipeMixParams }),
  z.object({ recipe: z.literal("clay-to-photoreal"), params: RecipeClayParams }),
  z.object({ recipe: z.literal("floor-plan-furnish"), params: RecipePromptOnlyParams }),
  z.object({ recipe: z.literal("tone-unify"), params: RecipePromptOnlyParams }),
  z.object({ recipe: z.literal("lighting-enhance"), params: RecipePromptOnlyParams }),
  z.object({ recipe: z.literal("plan-to-isometric"), params: RecipePromptOnlyParams }),
  z.object({ recipe: z.literal("evolution-grid"), params: RecipePromptOnlyParams }),
]);

/** Get-or-create the room's Workshop render session (idempotent by roomId). */
async function getOrCreateWorkshopSession(env: Env, roomId: number | null): Promise<string> {
  const db = drizzle(env.DB);
  if (roomId != null) {
    const existing = await db
      .select()
      .from(renderSessions)
      .where(and(eq(renderSessions.roomId, roomId), eq(renderSessions.name, "workshop")))
      .get();
    if (existing) return existing.id;
  }
  const id = crypto.randomUUID();
  await db
    .insert(renderSessions)
    .values({ id, roomId: roomId ?? null, name: "workshop" })
    .run();
  return id;
}

workshopRouter.openapi(
  createRoute({
    method: "post",
    path: "/nodes/{id}/recipe",
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { "application/json": { schema: RecipeRequestSchema } } },
    },
    responses: {
      201: {
        description: "Recipe ran synchronously — child node created with the render result",
        content: {
          "application/json": {
            schema: z.object({
              success: z.literal(true),
              node: BoardNodeSchema,
              renderCanvasId: z.string().nullable(),
              sessionId: z.string(),
              clipping: ClippingSchema.optional(),
            }),
          },
        },
      },
      400: { description: "Bad request", content: { "application/json": { schema: ErrorSchema } } },
      404: { description: "Node not found", content: { "application/json": { schema: ErrorSchema } } },
      500: { description: "Server error", content: { "application/json": { schema: ErrorSchema } } },
    },
    tags: ["workshop"],
    summary: "Run a node-action recipe (extract | material-swap | mix | clay-to-photoreal | floor-plan-furnish | tone-unify | lighting-enhance | plan-to-isometric | evolution-grid)",
    operationId: "runNodeRecipe",
  }),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const db = drizzle(c.env.DB);

      const node = await db.select().from(boardNodes).where(eq(boardNodes.id, id)).get();
      if (!node) return c.json({ error: "Node not found" }, 404);

      const board = await db.select().from(workstationBoards).where(eq(workstationBoards.id, node.boardId)).get();
      if (!board) return c.json({ error: "Board not found for node" }, 404);
      const roomId = board.roomId;

      // ---- extract: crop + save clipping, no render-session/model call needed ----
      if (body.recipe === "extract") {
        const clipping = await extractClipping(c.env, {
          roomId,
          sourceCfImageUrl: node.cfImageUrl,
          bbox: body.params.bbox,
          label: body.params.label,
          isGlobal: body.params.isGlobal,
        });

        const childId = crypto.randomUUID();
        await db
          .insert(boardNodes)
          .values({
            id: childId,
            boardId: node.boardId,
            kind: "image",
            cfImageUrl: clipping.clippingCfImageUrl,
            sourceType: "clipping",
            sourceId: clipping.id,
            parentNodeId: node.id,
            x: node.x + 40,
            y: node.y + node.height + 60,
            width: node.width,
            height: node.height,
          })
          .run();
        const childNode = await db.select().from(boardNodes).where(eq(boardNodes.id, childId)).get();
        if (!childNode) return c.json({ error: "Failed to create clipping node" }, 500);

        return c.json(
          {
            success: true as const,
            node: serializeNode(childNode),
            renderCanvasId: null,
            sessionId: "",
            clipping: serializeClipping(clipping),
          },
          201,
        );
      }

      // ---- material-swap / mix: run a stage through the existing render pipeline ----
      const sessionId = await getOrCreateWorkshopSession(c.env, roomId);

      // Pin image_config from the REAL source pixel dimensions (FABLE_PROMPT hard
      // constraint — Gemini 3.x silently re-crops otherwise). Seeded/placed board
      // nodes carry canvas-layout placeholder width/height (e.g. the 320x240 /
      // 360-grid defaults), not the actual image's aspect ratio, so probe the
      // node's cfImageUrl once via env.IMAGES.info() rather than trusting them.
      // One fetch+probe per recipe run is cheap next to the model call itself;
      // never block the run if the probe fails — fall back to the node dims.
      let aspectSourceWidth = node.width;
      let aspectSourceHeight = node.height;
      try {
        const probed = await probeCfImageDimensions(c.env, node.cfImageUrl);
        aspectSourceWidth = probed.width;
        aspectSourceHeight = probed.height;
      } catch (probeErr) {
        console.error(
          `[workshop] Failed to probe true dimensions for node ${node.id} (${node.cfImageUrl}); falling back to node width/height:`,
          probeErr,
        );
      }
      const aspectRatio = nearestAspectRatio(aspectSourceWidth, aspectSourceHeight);

      let stageResult;
      if (body.recipe === "mix") {
        // mix: stage_5_LP_synthesis of the node's image (base) + the clippings' images.
        const { clippingIds, prompt } = body.params;
        const clippingRows = await Promise.all(
          clippingIds.map((clippingId) =>
            db.select().from(sampleClippings).where(eq(sampleClippings.id, clippingId)).get(),
          ),
        );
        const foundClippings = clippingRows.filter(
          (row): row is typeof sampleClippings.$inferSelect => row != null,
        );
        if (foundClippings.length === 0) {
          return c.json({ error: "No resolvable clippings" }, 400);
        }

        const references = foundClippings.map((clip, index) => ({
          url: clip.clippingCfImageUrl,
          label: clip.label || `sample ${index + 1}`,
        }));
        const imageUrls = [node.cfImageUrl, ...foundClippings.map((clip) => clip.clippingCfImageUrl)];
        const composedPrompt = buildRecipePrompt(RECIPES.mix, { userRequest: prompt, references });

        stageResult = await runStage({
          env: c.env,
          sessionId,
          type: RECIPES.mix.stageType,
          inputImageUrl: node.cfImageUrl,
          prompt: composedPrompt,
          parentCanvasId: node.renderCanvasId ?? null,
          roomId,
          aspectRatio,
          imageUrls,
        });
      } else {
        // material-swap | clay-to-photoreal | floor-plan-furnish — single-image
        // edit on the node with optional material/style references.
        const recipe = RECIPES[body.recipe];
        const refUrls =
          "referenceCfImageUrls" in body.params ? body.params.referenceCfImageUrls ?? [] : [];
        const references = refUrls.map((url, index) => ({
          url,
          label: `reference ${index + 1}`,
        }));
        const composedPrompt = buildRecipePrompt(recipe, {
          userRequest: body.params.prompt,
          references,
        });

        stageResult = await runStage({
          env: c.env,
          sessionId,
          type: recipe.stageType,
          inputImageUrl: node.cfImageUrl,
          prompt: composedPrompt,
          parentCanvasId: node.renderCanvasId ?? null,
          roomId,
          aspectRatio,
          references,
        });
      }

      if (!stageResult.outputDeliveryUrl) {
        return c.json({ error: "Render produced no output image" }, 500);
      }

      // runStage() already persisted the render_canvases row (+ any inspiration
      // junction rows) atomically via its own db.batch. The single board_nodes
      // child row here is a single-row write — a plain .run() (db.batch is for
      // multi-row atomic writes, e.g. the board-seed insert above).
      const childId = crypto.randomUUID();
      await db
        .insert(boardNodes)
        .values({
          id: childId,
          boardId: node.boardId,
          kind: "image" as const,
          cfImageUrl: stageResult.outputDeliveryUrl,
          sourceType: "render" as const,
          sourceId: stageResult.id,
          renderCanvasId: stageResult.id,
          parentNodeId: node.id,
          x: node.x + 40,
          y: node.y + node.height + 60,
          width: node.width,
          height: node.height,
        })
        .run();

      const childNode = await db.select().from(boardNodes).where(eq(boardNodes.id, childId)).get();
      if (!childNode) return c.json({ error: "Failed to create result node" }, 500);

      return c.json(
        {
          success: true as const,
          node: serializeNode(childNode),
          renderCanvasId: stageResult.id,
          sessionId,
        },
        201,
      );
    } catch (err) {
      console.error("[workshop] POST /nodes/:id/recipe failed:", err);
      return c.json({ error: "Failed to run recipe" }, 500);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /nodes/:id/extract-furnishings — vision → shopping-list items (recipe 6.1)
// ─────────────────────────────────────────────────────────────────────────────

/** A persisted furnishing row (wire shape). */
const FurnishingItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  category: z.string(),
  note: z.string(),
  status: z.string(),
});

function serializeFurnishing(row: typeof furnishingItems.$inferSelect) {
  return {
    id: row.id,
    label: row.label,
    category: row.category,
    note: row.note,
    status: row.status,
  };
}

workshopRouter.openapi(
  createRoute({
    method: "post",
    path: "/nodes/{id}/extract-furnishings",
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: {
        description: "Detected + persisted furnishings/materials",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), items: z.array(FurnishingItemSchema) }),
          },
        },
      },
      404: { description: "Node not found", content: { "application/json": { schema: ErrorSchema } } },
      500: { description: "Extraction failed", content: { "application/json": { schema: ErrorSchema } } },
    },
    summary: "Extract + persist furnishings/materials from a node image",
    operationId: "extractFurnishings",
  }),
  async (c) => {
    try {
      const { id } = c.req.valid("param");
      const db = drizzle(c.env.DB);
      const node = await db.select().from(boardNodes).where(eq(boardNodes.id, id)).get();
      if (!node) return c.json({ error: "Node not found" }, 404);

      const board = await db
        .select()
        .from(workstationBoards)
        .where(eq(workstationBoards.id, node.boardId))
        .get();
      if (!board) return c.json({ error: "Node not found" }, 404);

      const detected = await extractFurnishings(c.env, node.cfImageUrl);

      // Re-extract replaces this node's prior rows (delete-by-node + insert), atomic.
      const rows = detected.map((it) => ({
        id: crypto.randomUUID(),
        roomId: board.roomId,
        sourceNodeId: node.id,
        label: it.label,
        category: it.category,
        note: it.note,
      }));
      // db.batch requires a non-empty tuple; the delete-by-node is always first.
      const deleteStmt = db.delete(furnishingItems).where(eq(furnishingItems.sourceNodeId, node.id));
      const insertStmts = rows.map((row) => db.insert(furnishingItems).values(row));
      await db.batch([deleteStmt, ...insertStmts]);

      const saved = await db
        .select()
        .from(furnishingItems)
        .where(eq(furnishingItems.sourceNodeId, node.id))
        .all();
      return c.json({ success: true as const, items: saved.map(serializeFurnishing) }, 200);
    } catch (err) {
      console.error("[workshop] POST /nodes/:id/extract-furnishings failed:", err);
      return c.json({ error: "Failed to extract furnishings" }, 500);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /rooms/:roomId/furnishings — the room's saved shopping list
// ─────────────────────────────────────────────────────────────────────────────

workshopRouter.openapi(
  createRoute({
    method: "get",
    path: "/rooms/{roomId}/furnishings",
    request: { params: z.object({ roomId: z.coerce.number() }) },
    responses: {
      200: {
        description: "The room's persisted furnishings",
        content: {
          "application/json": {
            schema: z.object({ success: z.literal(true), items: z.array(FurnishingItemSchema) }),
          },
        },
      },
    },
    summary: "List a room's saved furnishings",
    operationId: "listRoomFurnishings",
  }),
  async (c) => {
    const { roomId } = c.req.valid("param");
    const db = drizzle(c.env.DB);
    const saved = await db
      .select()
      .from(furnishingItems)
      .where(eq(furnishingItems.roomId, roomId))
      .all();
    return c.json({ success: true as const, items: saved.map(serializeFurnishing) }, 200);
  },
);
