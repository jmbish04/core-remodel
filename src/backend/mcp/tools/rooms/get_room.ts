import {
  budgetTrackerItemRooms,
  budgetTrackerItems,
  floors,
  materialScheduleItems,
  rooms,
} from "@backend/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { formatCents, toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY, type RemodelDb } from "../../types";

import { roomDto } from "./_shared";

/** Look up active budget items linked to a room via the join table. */
async function budgetItemsForRoom(db: RemodelDb, roomId: number) {
  const links = await db
    .select({ budgetTrackerItemId: budgetTrackerItemRooms.budgetTrackerItemId })
    .from(budgetTrackerItemRooms)
    .where(eq(budgetTrackerItemRooms.roomId, roomId))
    .all();
  const ids = links.map((l) => l.budgetTrackerItemId);
  if (ids.length === 0) return [];
  const items = await db
    .select()
    .from(budgetTrackerItems)
    .where(and(inArray(budgetTrackerItems.id, ids), eq(budgetTrackerItems.isActive, true)))
    .all();
  return items.map((b) => ({
    id: b.id,
    trackId: b.trackId,
    title: b.title,
    status: b.status,
    estimatedLow: formatCents(b.estimatedLowCents),
    estimatedHigh: formatCents(b.estimatedHighCents),
    estimatedLowCents: b.estimatedLowCents,
    estimatedHighCents: b.estimatedHighCents,
  }));
}

export const getRoom = defineTool({
    name: "get_room",
    category: "rooms",
    title: "Get room detail",
    description:
      "Full detail for one room by `id` or `roomCode`: dimensions, all planning notes (problem/plumbing/electrical/structural/hvac/general), the floor it belongs to (`floorName`, e.g. \"Upper Level\" — decisive when deducing which of several same-purpose rooms a material belongs to), plus the budget line items linked to it and the material schedule items placed in it.",
    inputShape: {
      id: z.number().int().positive().optional(),
      roomCode: z.string().optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      id: z.number().int(),
      roomCode: z.string().nullable(),
      roomName: z.string().nullable(),
      floorId: z.number().int().nullable(),
      floorName: z.string().nullable(),
      dimensions: z.string().nullable(),
      areaSqFt: z.number().nullable(),
      linearFt: z.number().nullable(),
      isLivingSpace: z.boolean().nullable(),
      floor: looseObject({ id: z.number().int(), key: z.string(), name: z.string() }).nullable(),
      notes: z.object({
        problemAreas: z.string().nullable(),
        plumbing: z.string().nullable(),
        electrical: z.string().nullable(),
        structural: z.string().nullable(),
        hvac: z.string().nullable(),
        general: z.string().nullable(),
      }),
      budgetItems: z.array(
        looseObject({
          id: z.number().int(),
          trackId: z.string(),
          title: z.string().nullable(),
          status: z.string().nullable(),
          estimatedLow: z.string(),
          estimatedHigh: z.string(),
          estimatedLowCents: z.number().int().nullable(),
          estimatedHighCents: z.number().int().nullable(),
        }),
      ),
      materials: z.array(
        looseObject({
          id: z.number().int(),
          title: z.string().nullable(),
          brand: z.string().nullable(),
          model: z.string().nullable(),
          isPurchased: z.boolean().nullable(),
        }),
      ),
    },
    examples: [{ title: "By id", args: { id: 1 } }, { title: "By code", args: { roomCode: "primary_bath" } }],
    handler: async ({ db }, input) => {
      if (input.id == null && !input.roomCode) {
        toolError("Provide either `id` or `roomCode`.");
      }
      const [room] = await db
        .select()
        .from(rooms)
        .where(input.id != null ? eq(rooms.id, input.id) : eq(rooms.roomCode, input.roomCode as string))
        .limit(1);
      if (!room) toolError(`Room not found (${input.id ?? input.roomCode}). Call list_rooms for valid ids.`);

      const [floor] = await db.select().from(floors).where(eq(floors.id, room.floorId)).limit(1);
      const materials = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.roomId, room.id))
        .all();

      return {
        ...roomDto(room, floor?.name ?? null),
        floor: floor ? { id: floor.id, key: floor.key, name: floor.name } : null,
        notes: {
          problemAreas: room.problemAreas,
          plumbing: room.plumbingNotes,
          electrical: room.electricalNotes,
          structural: room.structuralNotes,
          hvac: room.hvacNotes,
          general: room.generalNotes,
        },
        budgetItems: await budgetItemsForRoom(db, room.id),
        materials: materials.map((m) => ({
          id: m.id,
          title: m.title,
          brand: m.brand,
          model: m.model,
          isPurchased: m.isPurchased,
        })),
      };
    },
  });
