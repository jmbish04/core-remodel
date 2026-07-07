/**
 * Room-context resolver for the Workshop board (docs/0014_ai_photo_workshop).
 *
 * Gathers a room's real artifacts — listing photos, blank canvases, inspiration —
 * as a flat list of "seed" candidates for a freshly-created `workstation_boards`
 * board. Each candidate already carries a resolved Cloudflare Images delivery URL
 * so the caller never has to re-derive tokens.
 */
import { drizzle } from "drizzle-orm/d1";
import { eq, inArray } from "drizzle-orm";

import { images, inspirationalImageRooms, listingPhotos } from "@backend/db";

/** Matches board_nodes.sourceType / photo_collection_items.sourceType. */
export type SeedSourceType = "listing_photo" | "blank_canvas" | "inspiration";

export interface RoomArtifactSeed {
  cfImageUrl: string;
  sourceType: SeedSourceType;
  sourceId: string;
}

/** Build a Cloudflare Images delivery URL from a stored token/id (or pass through a URL). */
export function deliveryUrlFromToken(token: string): string {
  if (token.startsWith("http")) return token;
  return `https://imagedelivery.net/${token}/public`;
}

/**
 * Resolve a room's real artifacts (listing photos + their blank canvases +
 * room-scoped inspiration) as an ordered, flat seed list. Order is stable
 * (listing photos, then blank canvases, then inspiration) so board layout is
 * deterministic across board-create calls.
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
    if (lp.cfImageId) {
      seeds.push({
        cfImageUrl: deliveryUrlFromToken(lp.cfImageId),
        sourceType: "listing_photo",
        sourceId: String(lp.id),
      });
    }
    if (lp.blankCanvasCfImageId) {
      seeds.push({
        cfImageUrl: deliveryUrlFromToken(lp.blankCanvasCfImageId),
        sourceType: "blank_canvas",
        sourceId: String(lp.id),
      });
    }
  }

  const inspirationMappings = await db
    .select()
    .from(inspirationalImageRooms)
    .where(eq(inspirationalImageRooms.roomId, roomId))
    .all();

  if (inspirationMappings.length > 0) {
    const inspirationImageIds = inspirationMappings.map((m) => m.imageId);
    const inspirationImages = await db
      .select()
      .from(images)
      .where(inArray(images.id, inspirationImageIds))
      .all();
    const byId = new Map(inspirationImages.map((img) => [img.id, img] as const));

    for (const mapping of inspirationMappings) {
      const img = byId.get(mapping.imageId);
      if (!img) continue;
      const token = img.cfImageIdOptimized ?? img.cfImageIdOriginal;
      if (!token) continue;
      seeds.push({
        cfImageUrl: deliveryUrlFromToken(token),
        sourceType: "inspiration",
        sourceId: img.id,
      });
    }
  }

  return seeds;
}
