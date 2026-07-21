import { materialScheduleItems, rooms } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { defineTool, WRITE } from "../../types";
import { materialUrl } from "../../urls";
import {
  assertActiveTaxonomyIds,
  materialDto,
  materialDtoSchema,
  replaceTaxonomyMappings,
  roomNameMap,
} from "./_shared";

export const updateMaterial = defineTool({
    name: "update_material",
    category: "materials",
    title: "Update material",
    description:
      "Patch a material's fields. Only the fields you pass are changed. Editable: title, roomId (canonical room FK, validated), brand, model, notes, isPurchased, and the category tags. `categoryIds` / `subcategoryIds` REPLACE the existing mappings for that dimension (pass `[]` to clear); ids come from list_material_categories and are validated. To record a purchase with its product, prefer mark_material_purchased.",
    inputShape: {
      id: z.number().int().positive().describe("Material id (from list_materials)"),
      title: z.string().min(1).optional(),
      roomId: z.number().int().positive().optional().describe("Canonical room id (validated if passed)"),
      brand: z.string().optional(),
      model: z.string().optional(),
      notes: z.string().optional(),
      isPurchased: z.boolean().optional(),
      categoryIds: z
        .array(z.number().int().positive())
        .max(50)
        .optional()
        .describe("REPLACES the material's category mappings. Ids from list_material_categories."),
      subcategoryIds: z
        .array(z.number().int().positive())
        .max(50)
        .optional()
        .describe("REPLACES the material's subcategory mappings. Ids from list_material_categories."),
    },
    annotations: WRITE,
    outputShape: {
      updated: z.boolean(),
      material: materialDtoSchema,
      url: urlField,
    },
    examples: [
      { title: "Set brand + model", args: { id: 5, brand: "Bosch", model: "NIT8069UC" } },
      { title: "Append a note", args: { id: 5, notes: "Confirm 240V rough-in exists." } },
      { title: "Retag as a toilet", args: { id: 5, categoryIds: [2], subcategoryIds: [11] } },
    ],
    handler: async ({ env, db }, input) => {
      // categoryIds/subcategoryIds are mapping tables, not columns — keep them out of the patch.
      const { id, categoryIds, subcategoryIds, ...rest } = input;
      const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
      if (Object.keys(patch).length === 0 && !categoryIds && !subcategoryIds) {
        toolError("No fields to update — pass at least one field.");
      }
      const [existing] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, id))
        .limit(1);
      if (!existing) toolError(`Material ${id} not found. Call list_materials for valid ids.`);
      if (patch.roomId != null) {
        const [r] = await db.select().from(rooms).where(eq(rooms.id, patch.roomId as number)).limit(1);
        if (!r) toolError(`Room ${patch.roomId} not found. Call list_rooms for valid ids.`);
      }
      // Validate the vocabulary BEFORE any write — a hallucinated id must never
      // reach a FK column.
      await assertActiveTaxonomyIds(db, categoryIds, subcategoryIds);
      if (Object.keys(patch).length > 0) {
        await db.update(materialScheduleItems).set(patch).where(eq(materialScheduleItems.id, id)).run();
      }
      await replaceTaxonomyMappings(db, id, categoryIds, subcategoryIds);
      const [updated] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, id))
        .limit(1);
      const roomName = await roomNameMap(db, [updated.roomId]);
      return {
        updated: true,
        material: materialDto(updated, roomName.get(updated.roomId) ?? null),
        url: materialUrl(env, id),
      };
    },
  });
