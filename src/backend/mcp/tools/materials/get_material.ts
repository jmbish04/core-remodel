import {
  budgetItemMaterialMappings,
  budgetTrackerItems,
  materialRequiredSpecs,
  materialScheduleItems,
  productMaterialMappings,
  rooms,
} from "@backend/db";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { materialDto, materialDtoSchema } from "./_shared";

export const getMaterial = defineTool({
    name: "get_material",
    category: "materials",
    title: "Get material detail",
    description:
      "Full detail for one material by `id`: its required spec sheet, the canonical room it is linked to (roomId → room name), the ACTIVE budget line items it rolls up to (via budget_item_material_mappings → the stable budget trackId), and the showroom products mapped to it.",
    inputShape: {
      id: z.number().int().positive().describe("Material id (from list_materials)"),
    },
    annotations: READ_ONLY,
    outputShape: {
      ...materialDtoSchema.shape,
      room: looseObject({ id: z.number().int(), roomName: z.string() }).nullable(),
      requiredSpecs: z.array(looseObject({ id: z.number().int(), key: z.string(), value: z.string() })),
      budgetItems: z.array(
        looseObject({
          id: z.number().int(),
          trackId: z.string(),
          title: z.string(),
          status: z.string(),
        }),
      ),
      products: z.array(
        looseObject({ productId: z.number().int(), isPrimary: z.boolean().nullable() }),
      ),
    },
    examples: [{ title: "By id", args: { id: 1 } }],
    handler: async ({ db }, input) => {
      const [material] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, input.id))
        .limit(1);
      if (!material) {
        toolError(`Material ${input.id} not found. Call list_materials for valid ids.`);
      }

      // Required specs.
      const specs = await db
        .select()
        .from(materialRequiredSpecs)
        .where(eq(materialRequiredSpecs.materialId, material.id))
        .all();

      // Linked canonical room (name derived by joining rooms).
      let room: { id: number; roomName: string } | null = null;
      const [r] = await db.select().from(rooms).where(eq(rooms.id, material.roomId)).limit(1);
      if (r) room = { id: r.id, roomName: r.roomName };

      // Budget lines: mappings carry the stable trackId; resolve to ACTIVE rows.
      const budgetLinks = await db
        .select()
        .from(budgetItemMaterialMappings)
        .where(eq(budgetItemMaterialMappings.materialId, material.id))
        .all();
      const trackIds = budgetLinks.map((l) => l.budgetItemTrackId);
      let budgetItems: { id: number; trackId: string; title: string; status: string }[] = [];
      if (trackIds.length > 0) {
        const activeRows = await db
          .select()
          .from(budgetTrackerItems)
          .where(
            and(
              inArray(budgetTrackerItems.trackId, trackIds),
              eq(budgetTrackerItems.isActive, true),
            ),
          )
          .all();
        budgetItems = activeRows.map((b) => ({
          id: b.id,
          trackId: b.trackId,
          title: b.title,
          status: b.status,
        }));
      }

      // Mapped showroom products.
      const productLinks = await db
        .select()
        .from(productMaterialMappings)
        .where(eq(productMaterialMappings.materialId, material.id))
        .all();

      return {
        ...materialDto(material, room?.roomName ?? null),
        room,
        requiredSpecs: specs.map((s) => ({ id: s.id, key: s.key, value: s.value })),
        budgetItems,
        products: productLinks.map((p) => ({
          productId: p.productId,
          isPrimary: p.isPrimary,
        })),
      };
    },
  });
