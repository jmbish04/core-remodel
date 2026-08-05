import { scanMergeCandidates } from "@backend/services/showroom/branch-detection";
import { z } from "zod";

import { looseObject } from "../../schemas";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";

export const scanMergeCandidatesTool = defineTool({
  name: "scan_showroom_merge_candidates",
  category: "showrooms",
  title: "Scan for chain-branch merge candidates",
  description:
    "Detect groups of ACTIVE showroom stores that are BRANCHES of one business — two or more " +
    "distinct sites (each with its own zip/place_id) linked by a shared website, phone, address, " +
    "place_id or name — and stage each as a reviewable `showroom_merge_candidates` row. This is " +
    "the Tier-2 counterpart to dedup_showroom_stores: dedup MERGES same-site duplicate stubs, " +
    "this only PROPOSES collapsing real branches into one business with many locations, for a " +
    "human to confirm (via list/get/resolve/apply_merge_candidate). Idempotent — re-running " +
    "upserts by group_key, refreshes open candidates, and marks a candidate STALE when its group " +
    "no longer appears (e.g. a member was merged away). Excluded pairs (from a prior reject/exclude) " +
    "are skipped. Writes ONLY to the merge-candidate tables, never to showroom_stores.",
  inputShape: {},
  annotations: WRITE_IDEMPOTENT,
  examples: [{ title: "Scan the directory", args: {} }],
  outputShape: {
    detected: z.number().int(),
    created: z.number().int(),
    updated: z.number().int(),
    staled: z.number().int(),
    groups: z.array(
      looseObject({ groupKey: z.string(), status: z.string() }),
    ),
  },
  handler: async ({ db }) => {
    return scanMergeCandidates(db);
  },
});
