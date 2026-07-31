import { z } from "zod";

import { listVariants } from "../../../services/pascal/product";
import { defineTool, READ_ONLY } from "../../types";
import { variantDto } from "./_shared";

export const listVariantsTool = defineTool({
  name: "list_variants",
  category: "render",
  title: "List variants",
  description:
    "List variants (scenes) for a project or a single study. Each carries its editor deep-link, version, status, node count, and thumbnail.",
  inputShape: {
    projectId: z.string().optional(),
    studyId: z.string().optional(),
  },
  annotations: READ_ONLY,
  examples: [{ title: "Variants in a study", args: { studyId: "study-abc12345" } }],
  handler: async ({ env }, input) => {
    if (!input.projectId && !input.studyId) {
      return { variants: [], note: "Pass projectId or studyId." };
    }
    const rows = await listVariants(env, input);
    return { variants: rows.map((v) => variantDto(v, env)) };
  },
});
