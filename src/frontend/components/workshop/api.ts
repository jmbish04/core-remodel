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
}): Promise<Clipping> {
  const { data } = await request<{ clipping: Clipping }>(`/clippings/extract`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.clipping;
}

// Re-export the Board type for convenience at call sites.
export type { Board };
