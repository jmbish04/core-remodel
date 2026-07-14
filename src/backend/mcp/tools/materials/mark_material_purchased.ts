import { materialScheduleItems } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { defineTool, WRITE } from "../../types";
import { materialUrl } from "../../urls";
import { materialDto, materialDtoSchema, roomNameMap } from "./_shared";

export const markMaterialPurchased = defineTool({
    name: "mark_material_purchased",
    category: "materials",
    title: "Mark material purchased",
    description:
      "Flag a material as purchased (sets isPurchased=true) and optionally record the showroom product it was bought as (purchasedShowroomProductId). This only flips the purchase flag — it does NOT record the actual dollar amount; log real spend with the budget expense tool separately. Validates the material exists.",
    inputShape: {
      materialId: z.number().int().positive().describe("Material id (from list_materials)"),
      purchasedShowroomProductId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Showroom product id this material was purchased as (optional)"),
    },
    annotations: WRITE,
    outputShape: {
      purchased: z.boolean(),
      material: materialDtoSchema,
      url: urlField,
    },
    examples: [
      { title: "Just mark purchased", args: { materialId: 5 } },
      { title: "With product", args: { materialId: 5, purchasedShowroomProductId: 88 } },
    ],
    handler: async ({ env, db }, input) => {
      const [material] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, input.materialId))
        .limit(1);
      if (!material) {
        toolError(`Material ${input.materialId} not found. Call list_materials for valid ids.`);
      }
      const patch: { isPurchased: boolean; purchasedShowroomProductId?: number } = {
        isPurchased: true,
      };
      if (input.purchasedShowroomProductId != null) {
        patch.purchasedShowroomProductId = input.purchasedShowroomProductId;
      }
      await db
        .update(materialScheduleItems)
        .set(patch)
        .where(eq(materialScheduleItems.id, input.materialId))
        .run();
      const [updated] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, input.materialId))
        .limit(1);
      const roomName = await roomNameMap(db, [updated.roomId]);
      return {
        purchased: true,
        material: materialDto(updated, roomName.get(updated.roomId) ?? null),
        url: materialUrl(env, input.materialId),
      };
    },
  });
