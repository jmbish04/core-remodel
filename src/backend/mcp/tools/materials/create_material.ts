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
} from "./_shared";

export const createMaterial = defineTool({
    name: "create_material",
    category: "materials",
    title: "Create material",
    description:
      "Add a new material schedule item. `title` and `roomId` are required — every material belongs to a canonical room (hard FK, validated). Optionally set `brand`, `model`, `notes`, and tag it with `categoryIds` / `subcategoryIds` from list_material_categories (validated; unknown or inactive ids are rejected). The room's display name is derived on read; there is no freeform room label.",
    inputShape: {
      title: z.string().min(1).describe("Material name, e.g. \"Induction cooktop\""),
      roomId: z
        .number()
        .int()
        .positive()
        .describe("Canonical room id this material belongs to (from list_rooms) — required"),
      brand: z.string().optional(),
      model: z.string().optional(),
      notes: z.string().optional(),
      categoryIds: z
        .array(z.number().int().positive())
        .optional()
        .describe("Category ids from list_material_categories — must exist and be active"),
      subcategoryIds: z
        .array(z.number().int().positive())
        .optional()
        .describe("Subcategory ids from list_material_categories — must exist and be active"),
    },
    annotations: WRITE,
    outputShape: {
      created: z.boolean(),
      material: materialDtoSchema,
      url: urlField,
    },
    examples: [
      { title: "Roomed + branded", args: { title: "Toilet", roomId: 3, brand: "Kohler", model: "K-3999" } },
      {
        title: "Categorised",
        args: { title: "Toilet", roomId: 3, categoryIds: [2], subcategoryIds: [11] },
      },
    ],
    handler: async ({ env, db }, input) => {
      const [r] = await db.select().from(rooms).where(eq(rooms.id, input.roomId)).limit(1);
      if (!r) toolError(`Room ${input.roomId} not found. Call list_rooms for valid ids.`);
      // Validate the vocabulary BEFORE any write — a hallucinated id must never
      // reach a FK column.
      await assertActiveTaxonomyIds(db, input.categoryIds, input.subcategoryIds);

      const [created] = await db
        .insert(materialScheduleItems)
        .values({
          title: input.title,
          roomId: input.roomId,
          brand: input.brand ?? null,
          model: input.model ?? null,
          notes: input.notes ?? null,
        })
        .returning();

      // D1 has no transactions and a batch cannot feed the generated id forward,
      // so this is sequential with a compensating delete: a failed mapping insert
      // must not leave an orphan material behind.
      if (input.categoryIds || input.subcategoryIds) {
        try {
          await replaceTaxonomyMappings(db, created.id, input.categoryIds, input.subcategoryIds);
        } catch (err) {
          await db
            .delete(materialScheduleItems)
            .where(eq(materialScheduleItems.id, created.id))
            .run();
          throw err;
        }
      }
      return { created: true, material: materialDto(created, r.roomName), url: materialUrl(env, created.id) };
    },
  });
