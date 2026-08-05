import { CollapseError, collapseCandidate } from "@backend/services/showroom/branch-collapse";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, DESTRUCTIVE } from "../../types";

export const applyMergeCandidate = defineTool({
  name: "apply_merge_candidate",
  category: "showrooms",
  title: "Collapse an approved merge candidate",
  description:
    "COLLAPSE an APPROVED merge candidate: carry each BRANCH member's site across as a location " +
    "on the keeper, remap all its child rows, then soft-delete the branch store. The keeper " +
    "becomes one business with many locations. Refuses any candidate that is not APPROVED — " +
    "approve it with resolve_merge_candidate first, and use exclude_member there to drop any " +
    "co-located different company BEFORE applying. Idempotent and resumable: if a previous run " +
    "failed partway, calling it again picks up each member from its recorded collapse_state " +
    "without double-applying. If a member was deactivated since approval the candidate is marked " +
    "STALE and nothing is written — re-scan and re-approve.",
  inputShape: {
    id: z
      .number()
      .int()
      .positive()
      .describe("APPROVED merge candidate id (from list_merge_candidates)"),
  },
  annotations: DESTRUCTIVE,
  examples: [{ title: "Collapse an approved candidate", args: { id: 3 } }],
  outputShape: {
    candidateId: z.number().int(),
    keeperStoreId: z.number().int(),
    status: z.string(),
    members: z.array(looseObject({ storeId: z.number().int(), to: z.string() })),
    excludedPairsWritten: z.number().int(),
  },
  handler: async ({ db }, input) => {
    try {
      return await collapseCandidate(db, input.id);
    } catch (err) {
      if (err instanceof CollapseError) toolError(err.message);
      throw err;
    }
  },
});
