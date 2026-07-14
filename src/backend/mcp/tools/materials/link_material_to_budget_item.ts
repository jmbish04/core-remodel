import { budgetItemMaterialMappings, budgetTrackerItems, materialScheduleItems } from "@backend/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";
import { materialUrl } from "../../urls";

export const linkMaterialToBudgetItem = defineTool({
    name: "link_material_to_budget_item",
    category: "materials",
    title: "Link material to budget item",
    description:
      "Attribute a material to a budget line so spend rolls up to it. The mapping is keyed by the budget item's STABLE `trackId` (budget rows revise in place — a new row id every edit — so the row id would dangle). Pass `budgetItemTrackId` directly, or pass a `budgetItemId` row id and its trackId is looked up. Idempotent — if the (trackId, material) pair already exists it is skipped. Validates the material and budget item exist.",
    inputShape: {
      materialId: z.number().int().positive().describe("Material id (from list_materials)"),
      budgetItemTrackId: z
        .string()
        .min(1)
        .optional()
        .describe("Stable budget item trackId (preferred)"),
      budgetItemId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("A budget item row id; its trackId is resolved automatically"),
    },
    annotations: WRITE_IDEMPOTENT,
    outputShape: {
      linked: z.boolean(),
      created: z.boolean(),
      mappingId: z.number().int(),
      budgetItemTrackId: z.string(),
      materialId: z.number().int(),
      url: urlField,
    },
    examples: [
      { title: "By trackId", args: { materialId: 5, budgetItemTrackId: "bud_kitchen_appliances" } },
      { title: "By row id", args: { materialId: 5, budgetItemId: 42 } },
    ],
    handler: async ({ env, db }, input) => {
      if (!input.budgetItemTrackId && input.budgetItemId == null) {
        toolError("Provide either `budgetItemTrackId` or `budgetItemId`.");
      }
      const [material] = await db
        .select()
        .from(materialScheduleItems)
        .where(eq(materialScheduleItems.id, input.materialId))
        .limit(1);
      if (!material) {
        toolError(`Material ${input.materialId} not found. Call list_materials for valid ids.`);
      }

      // Resolve the stable trackId + confirm the budget item exists.
      let trackId = input.budgetItemTrackId;
      if (trackId == null) {
        const [row] = await db
          .select()
          .from(budgetTrackerItems)
          .where(eq(budgetTrackerItems.id, input.budgetItemId as number))
          .limit(1);
        if (!row) {
          toolError(`Budget item ${input.budgetItemId} not found. Call list_budget for valid ids.`);
        }
        trackId = row.trackId;
      } else {
        const [row] = await db
          .select()
          .from(budgetTrackerItems)
          .where(eq(budgetTrackerItems.trackId, trackId))
          .limit(1);
        if (!row) {
          toolError(`Budget item trackId "${trackId}" not found. Call list_budget for valid trackIds.`);
        }
      }

      // Idempotent upsert on (trackId, materialId).
      const [existing] = await db
        .select()
        .from(budgetItemMaterialMappings)
        .where(
          and(
            eq(budgetItemMaterialMappings.budgetItemTrackId, trackId),
            eq(budgetItemMaterialMappings.materialId, input.materialId),
          ),
        )
        .limit(1);
      if (existing) {
        return {
          linked: true,
          created: false,
          mappingId: existing.id,
          budgetItemTrackId: trackId,
          materialId: input.materialId,
          url: materialUrl(env, input.materialId),
        };
      }
      const [created] = await db
        .insert(budgetItemMaterialMappings)
        .values({ budgetItemTrackId: trackId, materialId: input.materialId })
        .returning();
      return {
        linked: true,
        created: true,
        mappingId: created.id,
        budgetItemTrackId: trackId,
        materialId: input.materialId,
        url: materialUrl(env, input.materialId),
      };
    },
  });
