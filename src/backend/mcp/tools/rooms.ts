/**
 * @fileoverview MCP tools — Rooms domain.
 *
 * Read + light-edit access to the home's room records (`rooms`), including the
 * budget line items and material schedule items attached to each room.
 * Rooms are never created/deleted via MCP (they mirror the physical home and
 * are managed through the floor-plan tooling); we only list, inspect, and
 * annotate them.
 */
import {
  budgetTrackerItemRooms,
  budgetTrackerItems,
  floors,
  materialScheduleItems,
  rooms,
} from "@backend/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { formatCents, matchesQuery, paginate, toolError } from "../format";
import { defineTool, READ_ONLY, WRITE, type RemodelTool, type RemodelDb } from "../types";

/** Shape a room row for tool output (dimensions folded into a readable string). */
function roomDto(r: typeof rooms.$inferSelect) {
  const dim =
    r.lengthFeet != null && r.widthFeet != null
      ? `${r.lengthFeet}'${r.lengthInches ?? 0}" x ${r.widthFeet}'${r.widthInches ?? 0}"`
      : null;
  return {
    id: r.id,
    roomCode: r.roomCode,
    roomName: r.roomName,
    floorId: r.floorId,
    asIsUse: r.asIsUse,
    dimensions: dim,
    areaSqFt: r.areaSqFt,
    isLivingSpace: r.isLivingSpace,
  };
}

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

export const roomTools: RemodelTool[] = [
  defineTool({
    name: "list_rooms",
    category: "rooms",
    title: "List rooms",
    description:
      "List the home's ACTIVE rooms (id, roomCode, roomName, floor, dimensions, areaSqFt). Optional free-text `q` filters by name/code/use. Use a room's `id` as the target for other tools (budget links, measurements, material links).",
    inputShape: {
      q: z.string().optional().describe("Free-text filter over room name / code / as-is use"),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: READ_ONLY,
    examples: [{ title: "All rooms", args: {} }, { title: "Find bathrooms", args: { q: "bath" } }],
    handler: async ({ db }, input) => {
      const all = await db.select().from(rooms).where(eq(rooms.isActive, true)).all();
      const filtered = input.q
        ? all.filter((r) => matchesQuery([r.roomName, r.roomCode, r.asIsUse], input.q as string))
        : all;
      return paginate(filtered.map(roomDto), input.limit ?? 50, input.offset ?? 0);
    },
  }),

  defineTool({
    name: "get_room",
    category: "rooms",
    title: "Get room detail",
    description:
      "Full detail for one room by `id` or `roomCode`: dimensions, all planning notes (problem/plumbing/electrical/structural/hvac/general), the floor it belongs to, plus the budget line items linked to it and the material schedule items placed in it.",
    inputShape: {
      id: z.number().int().positive().optional(),
      roomCode: z.string().optional(),
    },
    annotations: READ_ONLY,
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
        .where(eq(materialScheduleItems.roomName, room.roomName))
        .all();

      return {
        ...roomDto(room),
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
  }),

  defineTool({
    name: "update_room",
    category: "rooms",
    title: "Update room notes / dimensions",
    description:
      "Patch a room's planning notes and/or dimensions. Only the fields you pass are changed. Dimensions are whole feet + inches per side. Does NOT rename or deactivate rooms.",
    inputShape: {
      id: z.number().int().positive().describe("Room id (from list_rooms)"),
      asIsUse: z.string().optional(),
      lengthFeet: z.number().int().min(0).optional(),
      lengthInches: z.number().min(0).max(11.99).optional(),
      widthFeet: z.number().int().min(0).optional(),
      widthInches: z.number().min(0).max(11.99).optional(),
      areaSqFt: z.number().positive().optional(),
      problemAreas: z.string().optional(),
      plumbingNotes: z.string().optional(),
      electricalNotes: z.string().optional(),
      structuralNotes: z.string().optional(),
      hvacNotes: z.string().optional(),
      generalNotes: z.string().optional(),
    },
    annotations: WRITE,
    examples: [
      { title: "Add a plumbing note", args: { id: 3, plumbingNotes: "Move supply lines to the north wall." } },
    ],
    handler: async ({ db }, input) => {
      const { id, ...rest } = input;
      const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(patch).length === 0) toolError("No fields to update — pass at least one field.");
      const [existing] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
      if (!existing) toolError(`Room ${id} not found. Call list_rooms for valid ids.`);
      await db.update(rooms).set(patch).where(eq(rooms.id, id)).run();
      const [updated] = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
      return { updated: true, room: roomDto(updated) };
    },
  }),
];
