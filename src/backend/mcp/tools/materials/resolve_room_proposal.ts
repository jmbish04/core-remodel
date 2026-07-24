import { z } from "zod";

import { resolveProposal } from "@backend/services/materials/deduction";

import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";

export const resolveRoomProposalTool = defineTool({
  name: "resolve_room_proposal",
  category: "materials",
  title: "Resolve a material-room proposal",
  description:
    "Confirm a staged material→room proposal (0030) onto a room — the ONE place an ambiguous deduction becomes a real material in a real room. Mints the material into the chosen room and records the proposal `confirmed` (room matched the engine's pick) or `overridden` (you chose differently); either way the room is now \"taken\" for this type, feeding the learning step. Idempotent-ish: an already-resolved proposal returns its existing placement. `roomId` must be a real active room (see list_rooms).",
  inputShape: {
    proposalId: z.number().int().positive().describe("Proposal id (from list_room_proposals)"),
    roomId: z.number().int().positive().describe("Active room to place the material into (from list_rooms)"),
  },
  annotations: WRITE,
  outputShape: {
    materialId: z.number().int(),
    roomId: z.number().int(),
    status: z.string(),
  },
  examples: [{ title: "Place a toilet into the primary bath", args: { proposalId: 12, roomId: 3 } }],
  handler: async ({ db }, input) => {
    let result: Awaited<ReturnType<typeof resolveProposal>>;
    try {
      result = await resolveProposal(db, input.proposalId, input.roomId);
    } catch (err) {
      // resolveProposal throws only for a bad/inactive room.
      toolError((err as Error).message);
    }
    if (!result) {
      toolError(`Proposal ${input.proposalId} not found. Call list_room_proposals for valid ids.`);
    }
    return result;
  },
});
