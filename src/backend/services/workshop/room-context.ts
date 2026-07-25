/**
 * Room-context resolver for the Workshop board (docs/0014_ai_photo_workshop).
 *
 * Gathers a room's real artifacts — listing photos, blank canvases, inspiration —
 * as a flat list of "seed" candidates for a freshly-created `workstation_boards`
 * board, PLUS the non-persisted "drawer" lists the board response surfaces
 * alongside its nodes (Slice-1 feedback: only blank-canvas artifacts are seeded
 * as board_nodes; listing + inspiration photos live in drawers instead). Each
 * candidate already carries a resolved Cloudflare Images delivery URL so the
 * caller never has to re-derive tokens.
 */
import { drizzle } from "drizzle-orm/d1";
import { and, eq, inArray } from "drizzle-orm";

import { images, inspirationalImageRooms, listingPhotos } from "@backend/db";

/** Matches board_nodes.sourceType / photo_collection_items.sourceType. */
export type SeedSourceType = "listing_photo" | "blank_canvas" | "inspiration";

export interface RoomArtifactSeed {
  cfImageUrl: string;
  sourceType: SeedSourceType;
  sourceId: string;
}

/** A single drawer entry — never persisted as a board_nodes row. */
export interface RoomDrawerPhoto {
  sourceId: string;
  cfImageUrl: string;
  label: string | null;
}

/** Build a Cloudflare Images delivery URL from a stored token/id (or pass through a URL). */
export function deliveryUrlFromToken(token: string): string {
  if (token.startsWith("http")) return token;
  return `https://imagedelivery.net/${token}/public`;
}

/**
 * Resolve ONLY a room's blank-canvas artifacts as the board-seed candidate
 * list (Slice-1 feedback: listing + inspiration photos are drawer-only, never
 * seeded as board_nodes — the blank canvas is "what gets decorated").
 */
export async function resolveRoomArtifactSeeds(
  env: Env,
  roomId: number,
): Promise<RoomArtifactSeed[]> {
  const db = drizzle(env.DB);
  const seeds: RoomArtifactSeed[] = [];

  const roomListingPhotos = await db
    .select()
    .from(listingPhotos)
    .where(eq(listingPhotos.roomId, roomId))
    .all();

  for (const lp of roomListingPhotos) {
    if (lp.blankCanvasCfImageId) {
      seeds.push({
        cfImageUrl: deliveryUrlFromToken(lp.blankCanvasCfImageId),
        sourceType: "blank_canvas",
        sourceId: String(lp.id),
      });
    }
  }

  return seeds;
}

/**
 * Resolve a room's listing photos as drawer entries (NOT seeded as board
 * nodes — see resolveRoomArtifactSeeds). `label` is the listing photo's cheap
 * room-name/description text, or null.
 */
export async function resolveListingPhotoDrawer(
  env: Env,
  roomId: number,
): Promise<RoomDrawerPhoto[]> {
  const db = drizzle(env.DB);
  const roomListingPhotos = await db
    .select()
    .from(listingPhotos)
    .where(eq(listingPhotos.roomId, roomId))
    .all();

  return roomListingPhotos
    .filter((lp) => lp.cfImageId)
    .map((lp) => ({
      sourceId: String(lp.id),
      cfImageUrl: deliveryUrlFromToken(lp.cfImageId),
      label: lp.description ?? lp.roomName ?? null,
    }));
}

/**
 * Resolve a room's inspiration photos as drawer entries (NOT seeded as board
 * nodes — see resolveRoomArtifactSeeds). `label` is the image's displayName,
 * or null.
 */
export async function resolveInspirationDrawer(
  env: Env,
  roomId: number,
): Promise<RoomDrawerPhoto[]> {
  const db = drizzle(env.DB);
  const inspirationMappings = await db
    .select()
    .from(inspirationalImageRooms)
    .where(eq(inspirationalImageRooms.roomId, roomId))
    .all();

  if (inspirationMappings.length === 0) return [];

  const inspirationImageIds = inspirationMappings.map((m) => m.imageId);
  const inspirationImages = await db
    .select()
    .from(images)
    .where(inArray(images.id, inspirationImageIds))
    .all();
  const byId = new Map(inspirationImages.map((img) => [img.id, img] as const));

  const drawer: RoomDrawerPhoto[] = [];
  for (const mapping of inspirationMappings) {
    const img = byId.get(mapping.imageId);
    if (!img) continue;
    const token = img.cfImageIdOptimized ?? img.cfImageIdOriginal;
    if (!token) continue;
    drawer.push({
      sourceId: img.id,
      cfImageUrl: deliveryUrlFromToken(token),
      label: img.displayName ?? null,
    });
  }
  return drawer;
}

/**
 * Resolve a room's AI/SketchUp renders (`images.photoCategory = 'ai_render'`,
 * room-scoped) as drawer entries. These are real per-room source images the
 * Workshop can drag onto the canvas and run recipes on (material-swap, mix,
 * clay-to-photoreal). Drawer-only — never auto-seeded as board nodes.
 */
export async function resolveRenderDrawer(
  env: Env,
  roomId: number,
): Promise<RoomDrawerPhoto[]> {
  const db = drizzle(env.DB);
  const renderImages = await db
    .select()
    .from(images)
    .where(
      and(
        eq(images.roomId, roomId),
        eq(images.photoCategory, "ai_render"),
        eq(images.isDeleted, false),
      ),
    )
    .all();

  const drawer: RoomDrawerPhoto[] = [];
  for (const img of renderImages) {
    const token = img.cfImageIdOptimized ?? img.cfImageIdOriginal;
    if (!token) continue;
    drawer.push({
      sourceId: img.id,
      cfImageUrl: deliveryUrlFromToken(token),
      label: img.displayName ?? null,
    });
  }
  return drawer;
}

/** The static whole-house floor-plan asset served from the Worker's /public. */
const FLOOR_PLAN_ASSET_PATH = "/floorplans/126colby-listing-floorplan.jpg";

/**
 * Resolve the whole-house floor plan as a single drawer entry. It is the same
 * static asset for every room (Option #1: furnish-the-plan is a whole-house
 * action, not per-room). `origin` is the request origin so the URL Gemini
 * fetches is absolute + publicly reachable — no Cloudflare Images upload needed
 * (deliveryUrlFromToken passes http(s) URLs straight through).
 */
export function resolveFloorPlanDrawer(origin: string): RoomDrawerPhoto[] {
  return [
    {
      sourceId: "floorplan-house",
      cfImageUrl: `${origin}${FLOOR_PLAN_ASSET_PATH}`,
      label: "126 Colby — full floor plan",
    },
  ];
}
