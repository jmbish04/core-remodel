import { z } from "zod";

import { getProject } from "../../../services/pascal/store";
import { createStudy } from "../../../services/pascal/product";
import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";
import { studyDto } from "./_shared";

export const createStudyTool = defineTool({
  name: "create_study",
  category: "render",
  title: "Create a layout study",
  description:
    "Create a study — a named group of variants you're comparing, e.g. 'Upstairs island placement' or 'Kitchen table next to island'. Variants live under a study; `compare_layout_variants` compares within one. Title required; description optional rich text.",
  inputShape: {
    projectId: z.string().min(1),
    title: z.string().min(1).describe("e.g. 'Upstairs island placement'."),
    descriptionMarkdown: z.string().optional(),
    descriptionHtml: z.string().optional(),
  },
  annotations: WRITE,
  examples: [
    { title: "Island placement study", args: { projectId: "proj-abc12345", title: "Upstairs island placement" } },
  ],
  handler: async ({ env }, input) => {
    const project = await getProject(env, input.projectId);
    if (!project) return toolError(`Unknown projectId '${input.projectId}'`);
    const row = await createStudy(env, {
      projectId: input.projectId,
      title: input.title,
      descriptionMarkdown: input.descriptionMarkdown ?? null,
      descriptionHtml: input.descriptionHtml ?? null,
    });
    return studyDto(row);
  },
});
