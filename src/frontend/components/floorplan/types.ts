/**
 * @fileoverview floorplan/types.ts
 *
 * Shared type contracts for the floor-plan page (feature 0005, Phase 2).
 *
 * These mirror the enriched `GET /api/rooms/catalog` payload (task T2.1). The
 * floor-plan UI is built entirely from this single request — dots, hover cards,
 * and the sidebar room list all read from the same `CatalogRoom[]`, so the page
 * never issues per-room follow-up fetches.
 *
 * Coordinate system (see IMPLEMENTATION_PLAN §4.2):
 *   - The floorplan asset (/floorplans/126colby-listing-floorplan.jpg) is the
 *     lower + upper levels rendered SIDE BY SIDE in one image.
 *   - `floorplanXPct` / `floorplanYPct` are ABSOLUTE percentages over that single
 *     combined image and map directly to CSS `left` / `top`.
 *   - `floorplanXPct === null` (or `floorplanYPct === null`) means the room has no
 *     placement and renders NO dot; it still appears in the sidebar.
 *   - `floorplanFloorKey` drives sidebar grouping + the Lower/Upper switch. It does
 *     NOT gate dot visibility — every placed room's dot is always on screen.
 */

/**
 * Canonical floor identifiers.  `all_levels` is a synthetic bucket that never
 * carries placed rooms; we keep it in the union for completeness so a stray
 * value from the API does not break type-narrowing.
 */
export type FloorKey = "lower_level" | "upper_level" | "outside" | "all_levels";

/**
 * The level-toggle in the sidebar only ever switches between the two interior
 * levels.  Outside / unplaced rooms live in their own always-visible group.
 */
export type SidebarLevel = "lower_level" | "upper_level";

/**
 * A single room as returned by the enriched catalog endpoint.
 *
 * Fields after `displayName` are the T2.1 enrichment. They are typed as
 * potentially-absent (`?`) purely so this component degrades gracefully if it is
 * deployed a moment before the parallel API change lands; in steady state the API
 * always provides them. `FloorplanGalleryApp` backfills `listingCount` /
 * `inspirationCount` from the images endpoints when they are missing.
 */
export interface CatalogRoom {
  /** Stable numeric room id (FK target across the schema). */
  id: number;
  /** FK to the floor this room is nested under in the catalog tree. */
  floorId: number;
  /** Kebab-case slug used in room URLs (`/rooms/{roomCode}`). */
  roomCode: string;
  /** Raw room name (may collide across floors, e.g. "Bath"). */
  roomName: string;
  /** Disambiguated, display-ready name computed server-side. */
  displayName: string;

  /** Which floorplan canvas the dot belongs to + sidebar grouping key. */
  floorplanFloorKey: FloorKey | null;
  /** Absolute horizontal % over the combined floorplan image (0–100), or null. */
  floorplanXPct: number | null;
  /** Absolute vertical % over the combined floorplan image (0–100), or null. */
  floorplanYPct: number | null;

  /** Count of listing photos assigned to this room. */
  listingCount?: number;
  /** Count of inspiration photos mapped to this room. */
  inspirationCount?: number;
  /** Pre-resolved hero image delivery URL (representative → listing → inspiration). */
  heroImageUrl?: string | null;
  /** Formatted dimension string, e.g. `15'0" x 24'10"`, or null when unknown. */
  dimensions?: string | null;
  /** Integer square footage, or null when dimensions are absent. */
  sqft?: number | null;

  /** Optional raw dimension parts (used as a client-side fallback for `dimensions`). */
  lengthFeet?: number | null;
  lengthInches?: number | null;
  widthFeet?: number | null;
  widthInches?: number | null;
}

/** A floor with its nested rooms, as returned by the catalog endpoint. */
export interface CatalogFloor {
  id: number;
  key: FloorKey;
  name: string;
  levelOrder: number;
  rooms: CatalogRoom[];
}

/**
 * A room paired with everything the dot + hover card need to render.  This is the
 * fully-resolved view-model the parent builds once and threads down so the leaf
 * components stay presentational.
 */
export interface ResolvedRoom {
  room: CatalogRoom;
  /** Effective listing count (catalog value, else image-endpoint fallback). */
  listingCount: number;
  /** Effective inspiration count (catalog value, else image-endpoint fallback). */
  inspirationCount: number;
  /** Effective hero image url (catalog value, else first image fallback), or null. */
  heroImageUrl: string | null;
  /** Effective dimension string, or null. */
  dimensions: string | null;
  /** Effective square footage, or null. */
  sqft: number | null;
}

/**
 * Visual classification used for the dot color + status copy.
 *   - `listing`    → at least one listing photo (emerald).
 *   - `inspiration`→ inspiration-only (amber).
 *   - `none`       → placed but empty (muted).
 */
export type RoomStatus = "listing" | "inspiration" | "none";

/** Derive the dot status from effective counts. */
export function getRoomStatus(listingCount: number, inspirationCount: number): RoomStatus {
  if (listingCount > 0) return "listing";
  if (inspirationCount > 0) return "inspiration";
  return "none";
}
