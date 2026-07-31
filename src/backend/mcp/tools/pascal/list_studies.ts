import { z } from "zod";

import { listStudies } from "../../../services/pascal/product";
import { defineTool, READ_ONLY } from "../../types";
import { studyDto } from "./_shared";

export const listStudiesTool = defineTool({
  name: "list_studies",
  category: "render",
  title: "List a project's studies",
  description: "List the studies (variant groupings) under a project.",
  inputShape: { projectId: z.string().min(1) },
  annotations: READ_ONLY,
  examples: [{ title: "Studies for a project", args: { projectId: "proj-abc12345" } }],
  handler: async ({ env }, input) => {
    const rows = await listStudies(env, input.projectId);
    return { studies: rows.map(studyDto) };
  },
});
