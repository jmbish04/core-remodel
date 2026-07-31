/**
 * @fileoverview MCP tool — list_showroom_exclusions (Showrooms domain, 0032 D2c-2).
 * The not-interested list. Read-only; same service as REST.
 */
import { z } from "zod";

import { listExclusions } from "@backend/services/showroom/discovery-search";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const listShowroomExclusions = defineTool({
  name: "list_showroom_exclusions",
  category: "showrooms",
  title: "List not-interested places (exclusions)",
  description:
    "List the exclusion ('seen it, not interested, never show me again') list that's auto-applied to " +
    "every discovery sweep + proximity scan. Returns { count, exclusions: [{ id, placeId, name, " +
    "category, latitude, longitude, reasonMarkdown, source, createdAt }] }. Use `remove_showroom_" +
    "exclusion` to let a place resurface again.",
  inputShape: {
    limit: z.number().int().min(1).max(500).optional().describe("Max rows (default 200)."),
  },
  annotations: READ_ONLY,
  outputShape: { count: z.number().int(), exclusions: z.array(looseObject({})) },
  examples: [{ title: "Show my not-interested list", args: {} }],
  handler: async (ctx, input) => {
    const exclusions = await listExclusions(ctx.db, input.limit);
    return { count: exclusions.length, exclusions };
  },
});
