/**
 * @fileoverview MCP tool — decide_park_find (Showrooms domain).
 *
 * Apply a terminal decision to a Park-Finds candidate (0032 decision 1.d):
 *   • PROCESS → promote it to a real showroom_stores row (or link an existing one by
 *     place_id) and re-point the discovery visit + detour stop at it.
 *   • DO_NOT_PROCESS → reject it, optionally adding a permanent exclusion so the same
 *     place never re-surfaces on a future park or discovery search.
 *
 * Goes through the SAME service the /admin Park-Finds page uses — human and voice
 * decisions are identical (AGENTS.md parity contract).
 */
import { z } from "zod";

import { decideHitlCandidate } from "@backend/services/showroom/hitl-queue";

import { defineTool, WRITE } from "../../types";

export const decideParkFind = defineTool({
  name: "decide_park_find",
  category: "showrooms",
  title: "Approve or reject a park-find discovery candidate",
  description:
    "Decide one Park-Finds candidate (see `list_park_finds`). `PROCESS` promotes it into the " +
    "showroom directory (creates a showroom_stores row flagged as proximity-scan-discovered, or " +
    "links an existing store with the same Google place_id) and re-points its discovery visit + " +
    "detour stop at the real store. `DO_NOT_PROCESS` rejects it; pass `addExclusion: true` to also " +
    "record a permanent exclusion (with an optional reason note) so the same place is never " +
    "surfaced again. Idempotent. Returns { ok, decision, storeId?, exclusionId? }.",
  inputShape: {
    id: z.number().int().positive().describe("The showroom_store_hitl_queue candidate id."),
    decision: z
      .enum(["PROCESS", "DO_NOT_PROCESS"])
      .describe("PROCESS = add to directory; DO_NOT_PROCESS = reject."),
    addExclusion: z
      .boolean()
      .optional()
      .describe("DO_NOT_PROCESS only: also never surface this place again."),
    reasonMarkdown: z
      .string()
      .optional()
      .describe("Reason for the exclusion (markdown; stored with an html render cache)."),
    reasonHtml: z.string().optional().describe("Pre-rendered html for the reason note (optional)."),
  },
  annotations: WRITE,
  outputShape: {
    ok: z.boolean(),
    decision: z.string().optional(),
    storeId: z.number().int().optional().describe("The store this became, on PROCESS."),
    exclusionId: z.number().int().optional().describe("The exclusion created, on DO_NOT_PROCESS."),
    reason: z.string().optional().describe("Failure reason (not-found), when ok is false."),
  },
  examples: [
    { title: "Approve candidate 12 into the directory", args: { id: 12, decision: "PROCESS" } },
    {
      title: "Reject and never surface it again",
      args: {
        id: 13,
        decision: "DO_NOT_PROCESS",
        addExclusion: true,
        reasonMarkdown: "Not a remodel showroom — it's a moving-supplies outlet.",
      },
    },
  ],
  handler: async (ctx, input) => {
    const result = await decideHitlCandidate(ctx.db, input.id, {
      decision: input.decision,
      addExclusion: input.addExclusion,
      reasonMarkdown: input.reasonMarkdown ?? null,
      reasonHtml: input.reasonHtml ?? null,
    });
    return result;
  },
});
