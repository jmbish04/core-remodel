import { z } from "zod";

import { generateSeedGraph } from "../../../services/pascal/generator";
import { parseGraphJson } from "../../../services/pascal/shapes";
import { getProject, loadScene } from "../../../services/pascal/store";
import { createVariant, getStudy } from "../../../services/pascal/product";
import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";
import { variantDto } from "./_shared";

export const generateFloorplanVariant = defineTool({
  name: "generate_floorplan_variant",
  category: "render",
  title: "Generate a floorplan variant",
  description:
    "Create a new variant (scene) under a study. Two modes: (1) a deterministic BASE from Core-Remodel measurements — rooms as rectangles sized by measured feet, positioned by floorplan bbox (walls are added later in the editor); or (2) a BRANCH from an existing variant (`fromVariantId`) — copies its graph so you can then edit it. Opens as its own `/scene/:id` in the editor. NOTE: AI intent-driven geometry edits land in Phase 3 (`edit_scene_nodes`); pass `intent` to record intent, but it does not yet mutate geometry here.",
  inputShape: {
    studyId: z.string().min(1),
    name: z.string().min(1).describe("Variant label, e.g. 'Island centered'."),
    fromVariantId: z
      .string()
      .optional()
      .describe("Branch from this variant's graph instead of generating a base."),
    intent: z.string().optional().describe("Design intent (recorded; Phase-3 AI editing applies it)."),
  },
  annotations: WRITE,
  examples: [
    { title: "Base from measurements", args: { studyId: "study-abc12345", name: "Measured base" } },
    { title: "Branch a variant", args: { studyId: "study-abc12345", name: "Island moved", fromVariantId: "scene-def67890" } },
  ],
  handler: async ({ env, db }, input) => {
    const study = await getStudy(env, input.studyId);
    if (!study) return toolError(`Unknown studyId '${input.studyId}'`);
    const project = await getProject(env, study.projectId);
    if (!project) return toolError(`Study '${input.studyId}' has no project`);

    const generatedAt = new Date().toISOString();

    if (input.fromVariantId) {
      const parent = await loadScene(env, input.fromVariantId);
      if (!parent) return toolError(`Unknown fromVariantId '${input.fromVariantId}'`);
      const graph = parseGraphJson(parent.graphJson);
      const rendering = {
        coreRemodelProjectId: project.coreRemodelProjectId,
        variant: null,
        measurements: [],
        confidence: null,
        provenance: { source: "pascal" as const, generatedAt, sourceRevision: null, requestId: null },
      };
      const row = await createVariant(env, {
        studyId: input.studyId,
        projectId: project.id,
        name: input.name,
        graph,
        rendering,
        parentSceneId: input.fromVariantId,
      });
      return { ...variantDto(row, env), branchedFrom: input.fromVariantId };
    }

    const seed = await generateSeedGraph(db, {
      coreRemodelProjectId: project.coreRemodelProjectId,
      scopeType: project.scopeType,
      floorId: project.floorId,
      roomId: project.roomId,
      generatedAt,
    });
    if (seed.roomCount === 0) {
      return toolError(
        `No active rooms found for project scope (${project.scopeType}). Check the floor/room mapping.`,
      );
    }
    const row = await createVariant(env, {
      studyId: input.studyId,
      projectId: project.id,
      name: input.name,
      graph: seed.graph,
      rendering: seed.rendering,
    });
    return { ...variantDto(row, env), roomCount: seed.roomCount, note: seed.note };
  },
});
