import { materialScheduleItems, rooms } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";
import { materialUrl } from "../../urls";
import { materialDto, materialDtoSchema } from "./_shared";

export const linkMaterialToRoom = defineTool({
    name: "link_material_to_room",
    category: "materials",
    title: "Link material to room",
    description:
      "Set a material's canonical room (`roomId` FK). Idempotent — safe to retry; re-linking to the same room is a no-op. Validates that both the material and the room exist.",
    inputShape: {
      materialId: z.number().int().positive().describe("Material id (from list_materials)"),
      roomId: z.number().int().positive().describe("Canonical room id (from list_rooms)"),
    },
    annotations: WRITE_IDEMPOTENT,
    outputShape: {
      linked: z.boolean(),
      material: materialDtoSchema,
      url: urlField,
    },
    examples: [{ title: "Link", args: { materialId: 5, roomId: 3 } }],
    handler: async ({ env, db }, input) => {
      const [material] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, input.materialId))
        .limit(1);
      if (!material) {
        toolError(`Material ${input.materialId} not found. Call list_materials for valid ids.`);
      }
      const [room] = await db.select().from(rooms).where(eq(rooms.id, input.roomId)).limit(1);
      if (!room) toolError(`Room ${input.roomId} not found. Call list_rooms for valid ids.`);

      await db
        .update(materialScheduleItems)
        .set({ roomId: room.id })
        .where(eq(materialScheduleItems.id, input.materialId))
        .run();
      const [updated] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, input.materialId))
        .limit(1);
      return {
        linked: true,
        material: materialDto(updated, room.roomName),
        url: materialUrl(env, input.materialId),
      };
    },
  });
