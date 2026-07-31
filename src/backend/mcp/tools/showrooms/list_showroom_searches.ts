/**
 * @fileoverview MCP tool — list_showroom_searches (Showrooms domain, 0032 D2c-2).
 * List recent discovery searches (each a shareable slug). Read-only; same service as REST.
 */
import { z } from "zod";

import { listSearches } from "@backend/services/showroom/discovery-search";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const listShowroomSearches = defineTool({
  name: "list_showroom_searches",
  category: "showrooms",
  title: "List discovery searches",
  description:
    "List recent discovery searches (from `find_showrooms`), newest first. Each is a slug you can " +
    "open or refine. Returns { count, searches: [{ id, slug, title, status, currentRevision, " +
    "resultCount, summary, origin, createdAt, updatedAt }] }. status: running|ready|refining|final|error.",
  inputShape: {
    limit: z.number().int().min(1).max(200).optional().describe("Max rows (default 50)."),
  },
  annotations: READ_ONLY,
  outputShape: { count: z.number().int(), searches: z.array(looseObject({})) },
  examples: [{ title: "My recent searches", args: {} }],
  handler: async (ctx, input) => {
    const searches = await listSearches(ctx.db, input.limit);
    return { count: searches.length, searches };
  },
});
