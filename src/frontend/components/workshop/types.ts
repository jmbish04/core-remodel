// ---------------------------------------------------------------------------
// Workshop Slice-1 — wire-contract types.
//
// These mirror the /api/workshop contract EXACTLY (see the build brief). The
// API is authored in parallel; this file is the client-side source of truth.
// ---------------------------------------------------------------------------

export type NodeKind = "image";

export type NodeSourceType =
  | "listing_photo"
  | "blank_canvas"
  | "inspiration"
  | "clipping"
  | "render";

/** A free-floating node on the board (board_nodes row, view-model subset). */
export interface BoardNode {
  id: string;
  boardId: string;
  kind: NodeKind;
  cfImageUrl: string;
  sourceType: NodeSourceType;
  sourceId: string | null;
  renderCanvasId: string | null;
  parentNodeId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  isVisible: boolean;
  isLocked: boolean;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

/** A Gemini-extracted material clipping (the Sample Library "drawer"). */
export interface Clipping {
  id: string;
  roomId: string;
  sourceCfImageUrl: string;
  clippingCfImageUrl: string;
  label: string | null;
  bboxJson: string | null;
  renderCanvasId: string | null;
  createdAt: string;
}

/** An item inside a pile (photo_collection_items row). */
export interface CollectionItem {
  id: string;
  cfImageUrl: string;
  sourceType: NodeSourceType;
  sourceId: string | null;
  sortOrder: number;
}

/** A side-rail pile (photo_collections row). */
export interface Collection {
  id: string;
  name: string | null;
  dockSlot: number | null;
  items: CollectionItem[];
}

export interface Board {
  id: string;
  roomId: string;
  name: string;
}

export interface BoardResponse {
  success: boolean;
  board: Board;
  nodes: BoardNode[];
  collections: Collection[];
  clippings: Clipping[];
}

/** Normalized bbox (0..1) — what /clippings/extract expects. */
export interface NormalizedBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RecipeKind = "extract" | "material-swap" | "mix";

/** Synchronous recipe result. */
export interface RecipeSyncResult {
  node: BoardNode;
  renderCanvasId: string | null;
  sessionId: string | null;
  pending?: false;
}

/** Asynchronous recipe result — resolved later over the realtime socket. */
export interface RecipeAsyncResult {
  pending: true;
  sessionId: string;
  canvasId: string;
  placeholderNode: BoardNode;
}

export type RecipeResult = RecipeSyncResult | RecipeAsyncResult;

export function isAsyncRecipeResult(
  result: RecipeResult,
): result is RecipeAsyncResult {
  return (result as RecipeAsyncResult).pending === true;
}

// ---------------------------------------------------------------------------
// Room catalog (reused from /api/rooms/catalog — the room-pick screen).
// ---------------------------------------------------------------------------

export interface CatalogRoom {
  id: number;
  floorId: number;
  roomCode: string;
  roomName: string;
  displayName: string;
  floorKey: string;
  floorName: string;
}

export interface CatalogFloor {
  id: number;
  key: string;
  name: string;
  rooms: CatalogRoom[];
}

// ---------------------------------------------------------------------------
// Alt-text — every image node carries a descriptive alt derived from its
// source type + label (accessibility requirement).
// ---------------------------------------------------------------------------

const SOURCE_LABEL: Record<NodeSourceType, string> = {
  listing_photo: "Listing photo",
  blank_canvas: "Blank canvas",
  inspiration: "Inspiration image",
  clipping: "Material clipping",
  render: "Rendered variation",
};

export function nodeAltText(node: Pick<BoardNode, "sourceType" | "metadata">): string {
  const base = SOURCE_LABEL[node.sourceType] ?? "Board image";
  const label =
    node.metadata && typeof node.metadata.label === "string"
      ? node.metadata.label
      : null;
  return label ? `${base}: ${label}` : base;
}

export function clippingAltText(clipping: Pick<Clipping, "label">): string {
  return clipping.label
    ? `Material clipping: ${clipping.label}`
    : "Material clipping";
}
