/**
 * @fileoverview MCP tool — remove_showroom_exclusion (Showrooms domain, 0032 D2c-2).
 * Delete an exclusion so the place can resurface. Same service as REST.
 */
import { z } from "zod";

import { removeExclusion } from "@backend/services/showroom/discovery-search";

import { defineTool, DESTRUCTIVE } from "../../types";

export const removeShowroomExclusion = defineTool({
  name: "remove_showroom_exclusion",
  category: "showrooms",
  title: "Remove a not-interested place (un-exclude)",
  description:
    "Delete an exclusion by id (see `list_showroom_exclusions`) so the place can resurface in future " +
    "discovery sweeps + proximity scans again. Returns { ok, reason? }.",
  inputShape: { id: z.number().int().positive().describe("The showroom_exclusions id to remove.") },
  annotations: DESTRUCTIVE,
  outputShape: { ok: z.boolean(), reason: z.string().optional() },
  examples: [{ title: "Un-exclude place 7", args: { id: 7 } }],
  handler: async (ctx, input) => {
    return removeExclusion(ctx.db, input.id);
  },
});
