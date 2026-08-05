import { z } from "zod";

import { compareProductVariants } from "../../../services/pascal/workflow";
import { toolError } from "../../format";
import { defineTool, READ_ONLY } from "../../types";

export const compareLayoutVariants = defineTool({
  name: "compare_layout_variants",
  category: "render",
  title: "Compare layout variants",
  description:
    "Compare variants side-by-side — pass a `studyId` (all its variants) or explicit `variantIds`. Returns each variant's version, node count, latest snapshot, and measurement provenance so you can weigh the options in one call.",
  inputShape: {
    studyId: z.string().optional(),
    variantIds: z.array(z.string()).max(20).optional(),
  },
  annotations: READ_ONLY,
  examples: [{ title: "Compare a study's variants", args: { studyId: "study-abc12345" } }],
  handler: async ({ env }, input) => {
    if (!input.variantIds?.length && !input.studyId)
      return toolError("Pass a studyId or variantIds.");
    const variants = await compareProductVariants(env, input);
    if (variants.length === 0) return { variants: [], note: "No variants to compare." };
    return { count: variants.length, variants };
  },
});
