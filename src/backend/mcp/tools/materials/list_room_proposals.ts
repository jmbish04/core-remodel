import { z } from "zod";

import { listRoomProposals } from "@backend/services/materials/deduction";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

const PROPOSAL_STATUS = ["staged", "auto_confirmed", "confirmed", "overridden", "dismissed"] as const;

export const listRoomProposalsTool = defineTool({
  name: "list_room_proposals",
  category: "materials",
  title: "List material-room proposals",
  description:
    "Pending material→room deduction proposals from receipt line items (0030). A receipt says \"2× Kohler Fora Toilet\" but not WHICH of the three bathrooms; the engine narrows the rooms by elimination and, when more than one survives, ranks them. Each proposal is the staged ARGUMENT (candidates + evidence + reasoning), not the answer — resolve one with resolve_room_proposal to mint the material into a confirmed room. Defaults to `status=staged` (awaiting a human).",
  inputShape: {
    status: z
      .enum(PROPOSAL_STATUS)
      .optional()
      .describe("Which proposals to list. Default \"staged\" (awaiting confirmation)."),
  },
  annotations: READ_ONLY,
  outputShape: {
    proposals: z.array(
      looseObject({
        id: z.number().int(),
        title: z.string(),
        subcategoryId: z.number().int().nullable(),
        subcategoryName: z.string().nullable(),
        status: z.string(),
        confidence: z.number().int().nullable(),
        proposedRoomId: z.number().int().nullable(),
        proposedRoomName: z.string().nullable(),
        candidates: z.array(
          looseObject({
            roomId: z.number().int(),
            roomName: z.string(),
            kept: z.boolean(),
            score: z.number(),
            evidence: z.string(),
          }),
        ),
        reasoningMarkdown: z.string().nullable(),
      }),
    ),
    total: z.number().int(),
  },
  examples: [
    { title: "Pending proposals", args: {} },
    { title: "Already confirmed", args: { status: "confirmed" } },
  ],
  handler: async ({ db }, input) => {
    const proposals = await listRoomProposals(db, input.status ?? "staged");
    return { proposals, total: proposals.length };
  },
});
