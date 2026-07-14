import { materialScheduleItems } from "@backend/db";
import { z } from "zod";

import { matchesQuery, paginate } from "../../format";
import { pageOutput } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { materialDto, materialDtoSchema, roomNameMap } from "./_shared";

export const listMaterials = defineTool({
    name: "list_materials",
    category: "materials",
    title: "List materials",
    description:
      "List material schedule items (id, title, room, brand, model, purchased flag). Optional filters: `roomId` (canonical room FK), `isPurchased` (bool), `brand` (exact, case-insensitive), and free-text `q` over title/brand/model/notes. Use a material's `id` as the target for get_material, spec, and link tools.",
    inputShape: {
      roomId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Only materials linked to this canonical room id (from list_rooms)"),
      isPurchased: z
        .boolean()
        .optional()
        .describe("Filter by purchased status; omit to include both"),
      brand: z.string().optional().describe("Exact brand match (case-insensitive)"),
      q: z.string().optional().describe("Free-text filter over title / brand / model / notes"),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      ...pageOutput(materialDtoSchema),
    },
    examples: [
      { title: "All materials", args: {} },
      { title: "Unpurchased items in a room", args: { roomId: 3, isPurchased: false } },
      { title: "Search by keyword", args: { q: "cooktop" } },
    ],
    handler: async ({ db }, input) => {
      const all = await db.select().from(materialScheduleItems).all();
      const brandNeedle = input.brand?.trim().toLowerCase();
      const filtered = all.filter((m) => {
        if (input.roomId != null && m.roomId !== input.roomId) return false;
        if (input.isPurchased != null && (m.isPurchased ?? false) !== input.isPurchased) return false;
        if (brandNeedle && (m.brand ?? "").toLowerCase() !== brandNeedle) return false;
        if (input.q && !matchesQuery([m.title, m.brand, m.model, m.notes], input.q)) return false;
        return true;
      });
      const roomName = await roomNameMap(db, filtered.map((m) => m.roomId));
      return paginate(
        filtered.map((m) => materialDto(m, roomName.get(m.roomId) ?? null)),
        input.limit ?? 50,
        input.offset ?? 0,
      );
    },
  });
