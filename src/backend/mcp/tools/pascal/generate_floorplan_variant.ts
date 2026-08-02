import { z } from "zod";

import { applyNodeOps } from "../../../services/pascal/edit";
import { proposeEdits } from "../../../services/pascal/ai-edit";
import { generateSeedGraph } from "../../../services/pascal/generator";
import { parseGraphJson } from "../../../services/pascal/shapes";
import { getProject, loadScene, PascalStoreError } from "../../../services/pascal/store";
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

    // 1) Establish the starting graph + provenance (branch from a parent, or a
    //    deterministic measured base).
    let graph;
    let rendering;
    let parentSceneId: string | null = null;
    let extra: Record<string, unknown> = {};

    if (input.fromVariantId) {
      const parent = await loadScene(env, input.fromVariantId);
      if (!parent) return toolError(`Unknown fromVariantId '${input.fromVariantId}'`);
      // Prevent branching across projects — the parent must belong to this study's project.
      if (parent.projectId !== project.id) {
        return toolError(`fromVariantId '${input.fromVariantId}' belongs to a different project`);
      }
      graph = parseGraphJson(parent.graphJson);
      rendering = {
        coreRemodelProjectId: project.coreRemodelProjectId,
        variant: null,
        measurements: [],
        confidence: null,
        provenance: { source: "pascal" as const, generatedAt, sourceRevision: null, requestId: null },
      };
      parentSceneId = input.fromVariantId;
      extra = { branchedFrom: input.fromVariantId };
    } else {
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
      graph = seed.graph;
      rendering = seed.rendering;
      extra = { roomCount: seed.roomCount, note: seed.note };
    }

    // 2) Optionally apply the AI intent as validated node ops before saving.
    if (input.intent) {
      const boundsNote = rendering.measurements
        .map((m) => `${m.kind}=${m.value}${m.unit}`)
        .join(", ");
      const plan = await proposeEdits(env, { graph, intent: input.intent, boundsNote });
      let intentApplied = 0;
      let intentNote = plan.rationale;
      if (plan.ops.length > 0) {
        try {
          graph = applyNodeOps(graph, plan.ops);
          intentApplied = plan.ops.length;
        } catch (err) {
          // AI proposed an op referencing a bad node — keep the base, don't fail creation.
          intentNote =
            (err instanceof PascalStoreError ? err.message : "invalid AI ops") +
            " — variant created without the intent edits.";
        }
      }
      extra = { ...extra, intentApplied, intentRationale: intentNote };
    }

    const row = await createVariant(env, {
      studyId: input.studyId,
      projectId: project.id,
      name: input.name,
      graph,
      rendering,
      parentSceneId,
    });
    return { ...variantDto(row, env), ...extra };
  },
});
