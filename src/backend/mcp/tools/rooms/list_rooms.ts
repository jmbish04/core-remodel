import { floors, rooms } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { matchesQuery, paginate } from "../../format";
import { looseObject, pageOutput } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

import { roomDto } from "./_shared";

export const listRooms = defineTool({
    name: "list_rooms",
    category: "rooms",
    title: "List rooms",
    description:
      "List the home's ACTIVE rooms (id, roomCode, roomName, floorId + floorName, dimensions, areaSqFt). `floorName` (e.g. \"Upper Level\") is what disambiguates same-purpose rooms on different floors — use it when deducing which room a material belongs to. Optional free-text `q` filters by name/code/use/floor. Use a room's `id` as the target for other tools (budget links, measurements, material links).",
    inputShape: {
      q: z.string().optional().describe("Free-text filter over room name / code / as-is use"),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      ...pageOutput(
        looseObject({
          id: z.number().int(),
          roomCode: z.string().nullable(),
          roomName: z.string().nullable(),
          floorId: z.number().int().nullable(),
          floorName: z.string().nullable(),
          dimensions: z.string().nullable(),
          areaSqFt: z.number().nullable(),
          linearFt: z.number().nullable(),
        }),
      ),
    },
    examples: [{ title: "All rooms", args: {} }, { title: "Find bathrooms", args: { q: "bath" } }],
    handler: async ({ db }, input) => {
      // Floor name is joined, never stored on the room row.
      const all = await db
        .select({ room: rooms, floorName: floors.name })
        .from(rooms)
        .leftJoin(floors, eq(rooms.floorId, floors.id))
        .where(eq(rooms.isActive, true))
        .all();
      const filtered = input.q
        ? all.filter((r) =>
            matchesQuery(
              [r.room.roomName, r.room.roomCode, r.room.asIsUse, r.floorName],
              input.q as string,
            ),
          )
        : all;
      return paginate(
        filtered.map((r) => roomDto(r.room, r.floorName)),
        input.limit ?? 50,
        input.offset ?? 0,
      );
    },
  });
