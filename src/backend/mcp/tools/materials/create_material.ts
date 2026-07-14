import { materialScheduleItems, rooms } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { defineTool, WRITE } from "../../types";
import { materialUrl } from "../../urls";
import { materialDto, materialDtoSchema } from "./_shared";

export const createMaterial = defineTool({
    name: "create_material",
    category: "materials",
    title: "Create material",
    description:
      "Add a new material schedule item. `title` and `roomId` are required — every material belongs to a canonical room (hard FK, validated). Optionally set `brand`, `model`, `notes`. The room's display name is derived on read; there is no freeform room label.",
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
    },
    annotations: WRITE,
    outputShape: {
      created: z.boolean(),
      material: materialDtoSchema,
      url: urlField,
    },
    examples: [
      { title: "Roomed + branded", args: { title: "Toilet", roomId: 3, brand: "Kohler", model: "K-3999" } },
    ],
    handler: async ({ env, db }, input) => {
      const [r] = await db.select().from(rooms).where(eq(rooms.id, input.roomId)).limit(1);
      if (!r) toolError(`Room ${input.roomId} not found. Call list_rooms for valid ids.`);
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
      return { created: true, material: materialDto(created, r.roomName), url: materialUrl(env, created.id) };
    },
  });
