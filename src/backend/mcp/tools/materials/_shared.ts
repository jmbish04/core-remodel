/**
 * @fileoverview Shared helpers for the Materials MCP tools.
 */
import { materialScheduleItems, rooms } from "@backend/db";
import { inArray } from "drizzle-orm";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { type RemodelTool } from "../../types";

/** Shape a material row for tool output. `roomName` is derived (joined from `rooms`). */
export function materialDto(m: typeof materialScheduleItems.$inferSelect, roomName: string | null) {
  return {
    id: m.id,
    title: m.title,
    roomId: m.roomId,
    roomName,
    brand: m.brand,
    model: m.model,
    notes: m.notes,
    isPurchased: m.isPurchased ?? false,
    purchasedShowroomProductId: m.purchasedShowroomProductId,
  };
}

/** Output schema mirroring `materialDto` — used by every tool that returns one. */
export const materialDtoSchema = looseObject({
  id: z.number().int(),
  title: z.string().nullable(),
  roomId: z.number().int(),
  roomName: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  notes: z.string().nullable(),
  isPurchased: z.boolean(),
  purchasedShowroomProductId: z.number().int().nullable(),
});

/** Resolve room ids to display names in one query (for the derived `roomName`). */
export async function roomNameMap(
  db: Parameters<RemodelTool["handler"]>[0]["db"],
  roomIds: number[],
): Promise<Map<number, string>> {
  const ids = [...new Set(roomIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: rooms.id, roomName: rooms.roomName })
    .from(rooms)
    .where(inArray(rooms.id, ids))
    .all();
  return new Map(rows.map((r) => [r.id, r.roomName]));
}
