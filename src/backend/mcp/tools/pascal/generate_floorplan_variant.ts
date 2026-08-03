import { z } from "zod";

import { generateProductVariant } from "../../../services/pascal/workflow";
import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";
import { variantDto } from "./_shared";

export const generateFloorplanVariant = defineTool({
  name: "generate_floorplan_variant",
  category: "render",
  title: "Generate a floorplan variant",
  description:
    "Create a new variant (scene) under a study. Two modes: (1) a deterministic BASE from Core-Remodel measurements — rooms as rectangles sized by measured feet and positioned by floorplan bbox; or (2) a BRANCH from an existing variant (`fromVariantId`) that preserves its graph and measurement evidence. An optional `intent` applies validated structured AI node edits before the child scene is saved. Every result opens at its own `/scene/:id` in the Pascal editor.",
  inputShape: {
    studyId: z.string().min(1),
    name: z.string().min(1).describe("Variant label, e.g. 'Island centered'."),
    fromVariantId: z
      .string()
      .optional()
      .describe("Branch from this variant's graph instead of generating a base."),
    intent: z
      .string()
      .optional()
      .describe("Design intent applied as validated structured node edits."),
  },
  annotations: WRITE,
  examples: [
    { title: "Base from measurements", args: { studyId: "study-abc12345", name: "Measured base" } },
    {
      title: "Branch a variant",
      args: { studyId: "study-abc12345", name: "Island moved", fromVariantId: "scene-def67890" },
    },
  ],
  handler: async ({ env }, input) => {
    try {
      const { row, ...extra } = await generateProductVariant(env, input);
      return { ...variantDto(row, env), ...extra };
    } catch (error) {
      return toolError(error instanceof Error ? error.message : "Variant generation failed");
    }
  },
});
