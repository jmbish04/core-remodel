import { floors, rooms } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, WRITE } from "../../types";

import { roomDto } from "./_shared";

export const updateRoom = defineTool({
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
      // areaSqFt is not settable — area is computed from the dimensions (0043).
      problemAreas: z.string().optional(),
      plumbingNotes: z.string().optional(),
      electricalNotes: z.string().optional(),
      structuralNotes: z.string().optional(),
      hvacNotes: z.string().optional(),
      generalNotes: z.string().optional(),
    },
    annotations: WRITE,
    outputShape: {
      updated: z.boolean(),
      room: looseObject({
        id: z.number().int(),
        roomCode: z.string().nullable(),
        roomName: z.string().nullable(),
        floorId: z.number().int().nullable(),
        floorName: z.string().nullable(),
        dimensions: z.string().nullable(),
        areaSqFt: z.number().nullable(),
      }),
    },
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
      const [updated] = await db
        .select({ room: rooms, floorName: floors.name })
        .from(rooms)
        .leftJoin(floors, eq(rooms.floorId, floors.id))
        .where(eq(rooms.id, id))
        .limit(1);
      return { updated: true, room: roomDto(updated.room, updated.floorName) };
    },
  });
