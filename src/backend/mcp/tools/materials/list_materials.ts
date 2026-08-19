import { materialScheduleItems } from "@backend/db";
import { z } from "zod";

import { matchesQuery, paginate } from "../../format";
import { pageOutput } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { materialDto, materialWithTaxonomySchema, roomNameMap, taxonomyMap } from "./_shared";

export const listMaterials = defineTool({
    name: "list_materials",
    category: "materials",
    title: "List materials",
    description:
      "List material schedule items (id, title, room, brand, model, purchased flag, plus each item's `categories` and `subcategories` — joined names, so \"which materials are toilets\" is answerable from this call). Optional filters: `roomId` (canonical room FK), `isPurchased` (bool), `brand` (exact, case-insensitive), and free-text `q` over title/brand/model/notes. Use a material's `id` as the target for get_material, spec, and link tools.",
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
      includeInactive: z
        .boolean()
        .optional()
        .describe("Include soft-deleted (is_active=false) materials; default false"),
      q: z.string().optional().describe("Free-text filter over title / notes"),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: READ_ONLY,
    outputShape: {
      ...pageOutput(materialWithTaxonomySchema),
    },
    examples: [
      { title: "All materials", args: {} },
      { title: "Unpurchased items in a room", args: { roomId: 3, isPurchased: false } },
      { title: "Search by keyword", args: { q: "cooktop" } },
    ],
    handler: async ({ db }, input) => {
      const all = await db.select().from(materialScheduleItems).all();
      const filtered = all.filter((m) => {
        if (!input.includeInactive && (m.isActive ?? true) === false) return false;
        if (input.roomId != null && m.roomId !== input.roomId) return false;
        if (input.isPurchased != null && (m.isPurchased ?? false) !== input.isPurchased) return false;
        if (input.q && !matchesQuery([m.title, m.notes], input.q)) return false;
        return true;
      });
      // Paginate the raw rows first, then join names for the page only.
      const page = paginate(filtered, input.limit ?? 50, input.offset ?? 0);
      const roomName = await roomNameMap(db, page.items.map((m) => m.roomId));
      const taxonomy = await taxonomyMap(db, page.items.map((m) => m.id));
      return {
        ...page,
        items: page.items.map((m) => ({
          ...materialDto(m, roomName.get(m.roomId) ?? null),
          categories: taxonomy.get(m.id)?.categories ?? [],
          subcategories: taxonomy.get(m.id)?.subcategories ?? [],
        })),
      };
    },
  });
