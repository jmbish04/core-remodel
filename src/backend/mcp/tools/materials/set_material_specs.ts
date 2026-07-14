import { materialRequiredSpecs, materialScheduleItems } from "@backend/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { defineTool, WRITE } from "../../types";
import { materialUrl } from "../../urls";

export const setMaterialSpecs = defineTool({
    name: "set_material_specs",
    category: "materials",
    title: "Set material required specs",
    description:
      "Upsert the required-spec sheet for a material. Given `materialId` and an array of `{ key, value }`, each key is replaced if it already exists or inserted otherwise. Keys NOT included are left untouched (this does not clear the sheet). Validates the material exists.",
    inputShape: {
      materialId: z.number().int().positive().describe("Material id (from list_materials)"),
      specs: z
        .array(
          z.object({
            key: z.string().min(1).describe("Spec name, e.g. \"Burner Zones\""),
            value: z.string().min(1).describe("Required value, e.g. \"4\""),
          }),
        )
        .min(1)
        .describe("Spec rows to upsert (replace-by-key or insert)"),
    },
    annotations: WRITE,
    outputShape: {
      ok: z.boolean(),
      inserted: z.number().int(),
      replaced: z.number().int(),
      requiredSpecs: z.array(looseObject({ id: z.number().int(), key: z.string(), value: z.string() })),
      url: urlField,
    },
    examples: [
      {
        title: "Set two specs",
        args: {
          materialId: 5,
          specs: [
            { key: "Burner Zones", value: "4" },
            { key: "Width", value: '30"' },
          ],
        },
      },
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

      const existing = await db
        .select()
        .from(materialRequiredSpecs)
        .where(eq(materialRequiredSpecs.materialId, input.materialId))
        .all();
      const byKey = new Map(existing.map((s) => [s.key, s]));

      let inserted = 0;
      let replaced = 0;
      for (const spec of input.specs) {
        const prior = byKey.get(spec.key);
        if (prior) {
          await db
            .update(materialRequiredSpecs)
            .set({ value: spec.value })
            .where(eq(materialRequiredSpecs.id, prior.id))
            .run();
          replaced += 1;
        } else {
          await db
            .insert(materialRequiredSpecs)
            .values({ materialId: input.materialId, key: spec.key, value: spec.value })
            .run();
          inserted += 1;
        }
      }

      const specs = await db
        .select()
        .from(materialRequiredSpecs)
        .where(eq(materialRequiredSpecs.materialId, input.materialId))
        .all();
      return {
        ok: true,
        inserted,
        replaced,
        requiredSpecs: specs.map((s) => ({ id: s.id, key: s.key, value: s.value })),
        url: materialUrl(env, input.materialId),
      };
    },
  });
