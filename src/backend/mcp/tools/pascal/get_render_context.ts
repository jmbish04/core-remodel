import { z } from "zod";

import { getProject } from "../../../services/pascal/store";
import { listStudies, listVariants } from "../../../services/pascal/product";
import { toolError } from "../../format";
import { defineTool, READ_ONLY } from "../../types";
import { projectDto, studyDto, variantDto } from "./_shared";

export const getRenderContext = defineTool({
  name: "get_render_context",
  category: "render",
  title: "Get render context for a project",
  description:
    "Everything the AI needs to reason about a project's layouts: the project + scope, its studies, and every variant (with editor links + node counts). Geometry is measured feet placed on an approximate floorplan — refine walls in the editor. Use before generating or editing variants.",
  inputShape: { projectId: z.string().min(1) },
  annotations: READ_ONLY,
  examples: [{ title: "Context for a project", args: { projectId: "proj-abc12345" } }],
  handler: async ({ env }, input) => {
    const project = await getProject(env, input.projectId);
    if (!project) return toolError(`Unknown projectId '${input.projectId}'`);
    const [studies, variants] = await Promise.all([
      listStudies(env, input.projectId),
      listVariants(env, { projectId: input.projectId }),
    ]);
    return {
      project: projectDto(project, env),
      studies: studies.map(studyDto),
      variants: variants.map((v) => variantDto(v, env)),
      geometryNote:
        "Deterministic bases are rectangles sized by measured feet, positioned by floorplan bbox; walls/adjacency are refined in the editor.",
    };
  },
});
