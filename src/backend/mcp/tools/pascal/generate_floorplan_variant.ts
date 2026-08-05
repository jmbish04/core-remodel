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
    "Create a new Pascal scene under a study. Use it like a quick layout sketcher: first generate a deterministic BASE from Core Remodel measurements, then create BRANCH variants from an existing scene with a natural-language `intent` such as moving a kitchen island, trying a different appliance wall, or changing seating. The intent is converted into validated scene-node edits before the child scene is saved. Every result returns its Pascal `/scene/:id` editor link for 2D/3D review.",
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
      .describe(
        "Natural-language layout change to apply as validated scene-node edits, e.g. 'move the kitchen island toward the windows and add seating for four'.",
      ),
  },
  annotations: WRITE,
  examples: [
    { title: "Base from measurements", args: { studyId: "study-abc12345", name: "Measured base" } },
    {
      title: "Branch a kitchen island option",
      args: {
        studyId: "study-abc12345",
        name: "Island shifted toward windows",
        fromVariantId: "scene-def67890",
        intent:
          "Create a longer kitchen island with seating for four on the living-room side. Keep measured wall positions and clearances.",
      },
    },
  ],
  handler: async ({ env }, input) => {
    try {
      const { row, roomCount, note, branchedFrom, intentApplied, intentRationale } =
        await generateProductVariant(env, input);
      return {
        ...variantDto(row, env),
        generation: { roomCount, note, branchedFrom, intentApplied, intentRationale },
      };
    } catch (error) {
      console.error("[generate_floorplan_variant] workflow failed", error);
      return toolError("Variant generation failed");
    }
  },
});
