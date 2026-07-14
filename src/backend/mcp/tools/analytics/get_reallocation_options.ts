import {
  budgetTrackerItemRooms,
  budgetTrackerItems,
  materialScheduleItems,
  rooms,
} from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { formatCents, num } from "../../format";
import { looseObject } from "../../schemas";
import { READ_ONLY, defineTool } from "../../types";

export const getReallocationOptions = defineTool({
    name: "get_reallocation_options",
    category: "budget",
    title: "Reallocation options for a saving",
    description:
      "Given a saving (e.g. you spent less than budgeted on the fridge), surface candidate places to apply it: active, not-yet-done budget items ranked by estimated ceiling, optionally filtered to a room, plus rooms that still have unpurchased materials. This returns DATA for you to advise on — it does not move any money. Apply a decision with update_budget_item.",
    inputShape: {
      savedCents: z.number().int().describe("The amount saved, in cents (informational)"),
      focusRoomId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Restrict candidate budget items to this room"),
      limit: z.number().int().positive().max(50).optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      saving: z.string(),
      savingCents: z.number().int(),
      note: z.string(),
      candidateBudgetItems: z.array(
        looseObject({
          id: z.number().int(),
          trackId: z.string(),
          title: z.string().nullable(),
          status: z.string().nullable(),
          executionClass: z.string().nullable(),
          estimatedHigh: z.string(),
          estimatedHighCents: z.number().int(),
          rooms: z.array(z.string()),
        }),
      ),
      roomsNeedingMaterials: z.array(
        looseObject({
          room: z.string(),
          unpurchasedMaterials: z.number().int(),
        }),
      ),
    },
    examples: [
      { title: "Where to apply $5,000", args: { savedCents: 500000 } },
      { title: "Into the primary bath", args: { savedCents: 500000, focusRoomId: 3 } },
    ],
    handler: async ({ db }, input) => {
      const savedCents = num(input.savedCents) ?? 0;
      const limit = input.limit ?? 15;

      const [items, itemRooms, materials, allRooms] = await Promise.all([
        db.select().from(budgetTrackerItems).where(eq(budgetTrackerItems.isActive, true)).all(),
        db.select().from(budgetTrackerItemRooms).all(),
        db.select().from(materialScheduleItems).all(),
        db.select().from(rooms).where(eq(rooms.isActive, true)).all(),
      ]);
      const roomName = new Map(allRooms.map((r) => [r.id, r.roomName]));

      // roomId set per budget item (for optional focus filtering).
      const roomsByItem = new Map<number, number[]>();
      for (const l of itemRooms) {
        const arr = roomsByItem.get(l.budgetTrackerItemId) ?? [];
        arr.push(l.roomId);
        roomsByItem.set(l.budgetTrackerItemId, arr);
      }

      const candidates = items
        .filter((i) => i.status !== "done" && !i.isDraft)
        .filter((i) =>
          input.focusRoomId == null
            ? true
            : (roomsByItem.get(i.id) ?? []).includes(input.focusRoomId),
        )
        .map((i) => ({
          id: i.id,
          trackId: i.trackId,
          title: i.title,
          status: i.status,
          executionClass: i.executionClass,
          estimatedHigh: formatCents(i.estimatedHighCents),
          estimatedHighCents: i.estimatedHighCents ?? 0,
          rooms: (roomsByItem.get(i.id) ?? []).map((rid) => roomName.get(rid) ?? `room ${rid}`),
        }))
        .sort((a, b) => b.estimatedHighCents - a.estimatedHighCents)
        .slice(0, limit);

      // Rooms with unpurchased materials — natural places for extra budget.
      const unpurchasedByRoom = new Map<string, number>();
      for (const m of materials) {
        if (m.isPurchased) continue;
        const key = m.roomName ?? (m.roomId != null ? roomName.get(m.roomId) ?? "" : "");
        if (!key) continue;
        unpurchasedByRoom.set(key, (unpurchasedByRoom.get(key) ?? 0) + 1);
      }
      const roomsNeedingMaterials = [...unpurchasedByRoom.entries()]
        .map(([room, count]) => ({ room, unpurchasedMaterials: count }))
        .sort((a, b) => b.unpurchasedMaterials - a.unpurchasedMaterials);

      return {
        saving: formatCents(savedCents),
        savingCents: savedCents,
        note: "Advisory only — apply a decision with update_budget_item (adjust estimatedLow/HighCents).",
        candidateBudgetItems: candidates,
        roomsNeedingMaterials,
      };
    },
  });
