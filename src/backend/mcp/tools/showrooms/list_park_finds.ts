/**
 * @fileoverview MCP tool — list_park_finds (Showrooms domain).
 *
 * The Park-Finds review inbox over MCP: candidates the proximity scan flagged when
 * the car parked at an unregistered, remodel-relevant place (0032 decision 1.d). A
 * chat session can triage these exactly like the /admin Park-Finds page — same
 * service, same data. Default filter is `TBD` (awaiting a decision).
 */
import { z } from "zod";

import { listHitlQueue, countPending, HITL_DECISIONS } from "@backend/services/showroom/hitl-queue";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const listParkFinds = defineTool({
  name: "list_park_finds",
  category: "showrooms",
  title: "List park-find discovery candidates awaiting review",
  description:
    "List the Park-Finds HITL queue — places a proximity scan flagged when the car parked at an " +
    "unregistered, remodel-relevant business (decision 1.d). Each candidate is a possible new " +
    "showroom awaiting a human decision. Filter by `decision` (default TBD = undecided; PROCESS = " +
    "approved; DO_NOT_PROCESS = rejected). Use `decide_park_find` to approve (→ adds it to the " +
    "directory) or reject one. Returns { count, pending, candidates: [{ id, name, description, " +
    "categoryGuess, latitude, longitude, placeId, userDecision, driveListTitle, storeId }] }.",
  inputShape: {
    decision: z
      .enum(HITL_DECISIONS)
      .optional()
      .describe("Filter by decision. Omit for all; TBD = the review inbox (undecided)."),
    limit: z.number().int().min(1).max(500).optional().describe("Max rows (default 200)."),
  },
  annotations: READ_ONLY,
  outputShape: {
    count: z.number().int(),
    pending: z.number().int().describe("How many are still TBD (the inbox badge)."),
    candidates: z.array(looseObject({})),
  },
  examples: [
    { title: "Show me my undecided park finds", args: { decision: "TBD" } },
    { title: "All park finds, newest first", args: {} },
  ],
  handler: async (ctx, input) => {
    const [candidates, pending] = await Promise.all([
      listHitlQueue(ctx.db, { decision: input.decision, limit: input.limit }),
      countPending(ctx.db),
    ]);
    return { count: candidates.length, pending, candidates };
  },
});
