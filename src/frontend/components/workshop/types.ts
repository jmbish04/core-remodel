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
  | "render"
  | "floor_plan";

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

// ---------------------------------------------------------------------------
// Vector shape nodes (the devl.dev canvas-tools baseline, appended to our image
// nodes). Shapes are ALSO board_nodes: `kind` is free-form text and the shape's
// visual props live in the metadata JSON bag. They render on the SAME Konva
// stage as image nodes and participate in selection / z-index / layers / lineage
// exactly like any node.
//
// PERSISTENCE NOTE: the committed POST /boards/:id/nodes Zod schema is
// `kind: z.literal("image")` + `cfImageUrl: z.url()` with NO metadata field, and
// the response BoardNodeSchema restricts `kind` to ["image","note","group"]. So
// shape nodes cannot be persisted against the API as it stands WITHOUT a backend
// change (which this task must not make). `persistShapeNode` therefore attempts
// the real endpoint and degrades gracefully; shapes stay live client-side. See
// the handoff note in the task report for the exact schema widening required.
// ---------------------------------------------------------------------------

export type ShapeKind = "rectangle" | "ellipse" | "text" | "pen";

/** The visual payload stored in a shape node's `metadata` JSON bag. */
export interface ShapeMetadata {
  fill: string;
  /** 0..100 (matches the template + inspector slider). */
  opacity: number;
  /** Text content for `kind === "text"`. */
  text?: string;
  /**
   * Pen-stroke points for `kind === "pen"`, RELATIVE to the node origin (x,y),
   * flattened as [x0, y0, x1, y1, …] in world units (Konva.Line `points`).
   */
  points?: number[];
  /** Human layer name shown in the Layers panel. */
  name: string;
}

/**
 * A vector shape node. Geometry fields mirror BoardNode so the inspector,
 * layers panel, fit-to-screen, and selection logic can treat both uniformly.
 */
export interface ShapeNode {
  id: string;
  boardId: string;
  kind: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  isVisible: boolean;
  isLocked: boolean;
  metadata: ShapeMetadata;
}

/** Anything selectable on the canvas: an image node or a vector shape. */
export type CanvasNode = BoardNode | ShapeNode;

export function isShapeNode(node: CanvasNode): node is ShapeNode {
  return (
    node.kind === "rectangle" ||
    node.kind === "ellipse" ||
    node.kind === "text" ||
    node.kind === "pen"
  );
}

/** The 5 template swatches — content colors (fills), not chrome. */
export const SHAPE_SWATCHES = [
  "#3b82f6",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
] as const;

/** A Gemini-extracted material clipping (the Sample Library "drawer"). */
export interface Clipping {
  id: string;
  roomId: string;
  sourceCfImageUrl: string;
  clippingCfImageUrl: string;
  label: string | null;
  bboxJson: string | null;
  renderCanvasId: string | null;
  /**
   * Global-drawer membership. `true` → the clipping is promoted for use in
   * EVERY room's Workshop (e.g. a house-wide paint color) and appears in this
   * board's Global tab even if it was extracted in another room. `false` → this
   * room's own sample (the Samples tab).
   */
  isGlobal: boolean;
  createdAt: string;
}

/**
 * A whole listing/inspiration photo attached to this room's board. These are
 * NOT nodes on the canvas — per Slice-1 feedback only blank-canvas seeds live on
 * the canvas. Listing/inspiration photos live in drawer tabs and are placed onto
 * the canvas on demand (POST /boards/:id/nodes with their sourceType).
 */
export interface BoardPhoto {
  sourceId: string;
  cfImageUrl: string;
  label: string | null;
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
  /**
   * Blank-canvas seeds (+ recipe children / user-placed nodes) only. Listing and
   * inspiration photos NO LONGER arrive as nodes — they come back as
   * `listingPhotos` / `inspirationPhotos` and are placed on demand.
   */
  nodes: BoardNode[];
  collections: Collection[];
  /** All clippings visible to this board: this room's + every global clipping. */
  clippings: Clipping[];
  /** Whole listing photos for this room (drawer "Listing" tab). */
  listingPhotos: BoardPhoto[];
  /** Whole inspiration photos for this room (drawer "Inspiration" tab). */
  inspirationPhotos: BoardPhoto[];
  /** This room's AI/SketchUp renders (drawer "Renders" tab). */
  renderPhotos: BoardPhoto[];
  /** The whole-house floor plan (drawer "Plan" tab) — one shared entry. */
  floorPlanPhotos: BoardPhoto[];
}

/** Normalized bbox (0..1) — what /clippings/extract expects. */
export interface NormalizedBBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type RecipeKind =
  | "extract"
  | "material-swap"
  | "mix"
  | "clay-to-photoreal"
  | "floor-plan-furnish"
  | "tone-unify"
  | "lighting-enhance"
  | "plan-to-isometric"
  | "evolution-grid";

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
  floor_plan: "Floor plan",
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

export function boardPhotoAltText(
  photo: Pick<BoardPhoto, "label">,
  kind: "listing_photo" | "inspiration" | "render" | "floor_plan",
): string {
  const base = SOURCE_LABEL[kind];
  return photo.label ? `${base}: ${photo.label}` : base;
}

/** A short, human label for any canvas node — used by the Layers panel. */
export function canvasNodeLabel(node: CanvasNode): string {
  if (isShapeNode(node)) {
    return node.metadata.name;
  }
  return nodeAltText(node);
}
