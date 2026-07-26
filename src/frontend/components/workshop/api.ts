// ---------------------------------------------------------------------------
// Typed client for the /api/workshop surface.
//
// Every call forwards the remodel_access cookie via credentials:"include".
// Errors surface as thrown WorkshopApiError so callers can route them through
// toasts / the global error path rather than swallowing them.
// ---------------------------------------------------------------------------

import type {
  Board,
  BoardNode,
  BoardResponse,
  Clipping,
  Collection,
  CollectionItem,
  NodeSourceType,
  NormalizedBBox,
  RecipeKind,
  RecipeResult,
} from "./types";

const BASE = "/api/workshop";

export class WorkshopApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "WorkshopApiError";
    this.status = status;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<{ data: T; status: number }> {
  const response = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers:
      init?.body != null
        ? { "content-type": "application/json", ...(init?.headers ?? {}) }
        : init?.headers,
    ...init,
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    /* empty / non-JSON body (e.g. 204) */
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new WorkshopApiError(message, response.status);
  }

  return { data: payload as T, status: response.status };
}

// ---- Board ----------------------------------------------------------------

export async function getBoard(roomId: string): Promise<BoardResponse> {
  const { data } = await request<BoardResponse>(
    `/rooms/${encodeURIComponent(roomId)}/board`,
  );
  return data;
}

// ---- Nodes ----------------------------------------------------------------

export interface CreateNodeInput {
  kind: "image";
  cfImageUrl: string;
  sourceType: NodeSourceType;
  sourceId?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  parentNodeId?: string;
}

export async function createNode(
  boardId: string,
  input: CreateNodeInput,
): Promise<BoardNode> {
  const { data } = await request<{ node: BoardNode }>(
    `/boards/${encodeURIComponent(boardId)}/nodes`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data.node;
}

// ---- Shape nodes (vector) -------------------------------------------------
//
// Shapes are board_nodes too (free-form `kind`, visual props in a metadata JSON
// bag). We attempt to persist them through the SAME POST/PATCH node endpoints as
// images. IMPORTANT: the committed API's CreateNodeSchema is
// `kind: z.literal("image")` + `cfImageUrl: z.url()` with no metadata field, so
// these calls are REJECTED by the server today (no backend change allowed here).
// The functions below therefore best-effort the request and swallow the
// rejection — shapes stay live in client state either way. `cfImageUrl` uses the
// "about:shape" sentinel (a valid WHATWG URL, so it survives `z.url()` once the
// server's `kind`/`metadata` widening lands).

/** Sentinel URL for shape nodes (cfImageUrl is NOT NULL in the schema). */
export const SHAPE_CF_URL_SENTINEL = "about:shape";

export interface CreateShapeNodeInput {
  kind: "rectangle" | "ellipse" | "text" | "pen";
  x: number;
  y: number;
  width: number;
  height: number;
  /** Serialized ShapeMetadata JSON. */
  metadata: string;
  parentNodeId?: string;
}

/**
 * Best-effort shape persistence. Returns the server id on success, or `null`
 * when the API rejects the shape (current state) — the caller keeps its
 * client-generated id and the shape remains fully usable on the canvas.
 */
export async function createShapeNode(
  boardId: string,
  input: CreateShapeNodeInput,
): Promise<string | null> {
  try {
    const { data } = await request<{ node: BoardNode }>(
      `/boards/${encodeURIComponent(boardId)}/nodes`,
      {
        method: "POST",
        body: JSON.stringify({
          kind: input.kind,
          cfImageUrl: SHAPE_CF_URL_SENTINEL,
          sourceType: "blank_canvas",
          x: input.x,
          y: input.y,
          width: input.width,
          height: input.height,
          metadata: input.metadata,
          parentNodeId: input.parentNodeId,
        }),
      },
    );
    return data.node.id;
  } catch {
    // API contract doesn't yet accept shape nodes — degrade to client-only.
    return null;
  }
}

/** Best-effort shape transform persistence (no-throw). */
export async function patchShapeNode(
  id: string,
  patch: PatchNodeInput & { metadata?: string },
): Promise<void> {
  try {
    await request<unknown>(`/nodes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  } catch {
    /* shape persistence not yet accepted by the API — client state is source of truth */
  }
}

export interface PatchNodeInput {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  zIndex?: number;
  isVisible?: boolean;
  isLocked?: boolean;
}

export async function patchNode(
  id: string,
  patch: PatchNodeInput,
): Promise<BoardNode> {
  const { data } = await request<{ node: BoardNode }>(
    `/nodes/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return data.node;
}

export async function deleteNode(id: string): Promise<void> {
  await request<unknown>(`/nodes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ---- Recipes --------------------------------------------------------------

export async function runRecipe(
  nodeId: string,
  recipe: RecipeKind,
  params: Record<string, unknown>,
): Promise<RecipeResult> {
  const { data } = await request<RecipeResult>(
    `/nodes/${encodeURIComponent(nodeId)}/recipe`,
    { method: "POST", body: JSON.stringify({ recipe, params }) },
  );
  return data;
}

/** A persisted furnishing/material (procurement extraction, recipe 6.1). */
export interface FurnishingItem {
  id: string;
  label: string;
  category: string;
  note: string;
  /** detected | dismissed | adopted. */
  status: string;
}

/** Run the vision extraction over a node's image → persisted shopping-list items. */
export async function extractFurnishings(nodeId: string): Promise<FurnishingItem[]> {
  const { data } = await request<{ items: FurnishingItem[] }>(
    `/nodes/${encodeURIComponent(nodeId)}/extract-furnishings`,
    { method: "POST" },
  );
  return data.items;
}

/** Load a node's already-extracted furnishings (no re-scan). */
export async function getNodeFurnishings(nodeId: string): Promise<FurnishingItem[]> {
  const { data } = await request<{ items: FurnishingItem[] }>(
    `/nodes/${encodeURIComponent(nodeId)}/furnishings`,
  );
  return data.items;
}

/** Load a whole room's saved furnishings (the room shopping list). */
export async function getRoomFurnishings(roomId: number | string): Promise<FurnishingItem[]> {
  const { data } = await request<{ items: FurnishingItem[] }>(
    `/rooms/${encodeURIComponent(String(roomId))}/furnishings`,
  );
  return data.items;
}

/** Curate a furnishing — dismiss / adopt / link a product. */
export async function patchFurnishing(
  id: string,
  patch: { status?: "detected" | "dismissed" | "adopted"; productId?: number | null },
): Promise<FurnishingItem> {
  const { data } = await request<{ item: FurnishingItem }>(
    `/furnishings/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return data.item;
}

// ---- Piles (collections) --------------------------------------------------

export async function createCollection(
  boardId: string,
  name?: string,
): Promise<Collection> {
  const { data } = await request<{ collection: Collection }>(
    `/boards/${encodeURIComponent(boardId)}/collections`,
    { method: "POST", body: JSON.stringify(name ? { name } : {}) },
  );
  return data.collection;
}

export async function patchCollection(
  id: string,
  patch: { name?: string; dockSlot?: number },
): Promise<Collection> {
  const { data } = await request<{ collection: Collection }>(
    `/collections/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return data.collection;
}

export async function deleteCollection(id: string): Promise<void> {
  await request<unknown>(`/collections/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function addCollectionItem(
  collectionId: string,
  input: { cfImageUrl: string; sourceType: NodeSourceType; sourceId?: string },
): Promise<CollectionItem[]> {
  const { data } = await request<{ items: CollectionItem[] }>(
    `/collections/${encodeURIComponent(collectionId)}/items`,
    { method: "POST", body: JSON.stringify(input) },
  );
  return data.items;
}

export async function deleteCollectionItem(
  collectionId: string,
  itemId: string,
): Promise<CollectionItem[]> {
  const { data } = await request<{ items: CollectionItem[] }>(
    `/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(itemId)}`,
    { method: "DELETE" },
  );
  return data.items;
}

// ---- Clippings ------------------------------------------------------------

export async function extractClipping(input: {
  roomId: string;
  sourceCfImageUrl: string;
  bbox: NormalizedBBox;
  label?: string;
  /** When true, the new clipping is promoted to the global (all-rooms) drawer. */
  isGlobal?: boolean;
}): Promise<Clipping> {
  const { data } = await request<{ clipping: Clipping }>(`/clippings/extract`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.clipping;
}

/** Update a clipping's global-drawer membership and/or its label. */
export async function patchClipping(
  id: string,
  patch: { isGlobal?: boolean; label?: string },
): Promise<Clipping> {
  const { data } = await request<{ success: boolean; clipping: Clipping }>(
    `/clippings/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return data.clipping;
}

// Re-export the Board type for convenience at call sites.
export type { Board };
