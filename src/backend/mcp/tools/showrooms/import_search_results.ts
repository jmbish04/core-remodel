/**
 * @fileoverview MCP tool — import_search_results (Showrooms domain, 0032 D2c-2).
 * Promote chosen discovery results into the showroom directory. Same service as REST.
 */
import { z } from "zod";

import { importSearchResults } from "@backend/services/showroom/discovery-search";

import { defineTool, WRITE } from "../../types";

export const importSearchResultsTool = defineTool({
  name: "import_search_results",
  category: "showrooms",
  title: "Import discovery results into the directory",
  description:
    "Promote selected results of a discovery search into the showroom directory. For each result id: " +
    "links an existing store by Google place_id, else creates a new showroom_stores row (flagged " +
    "proximity-scan-discovered; address backfills from place_id), and stamps the result imported. Get " +
    "the result ids from `get_showroom_search`. Returns { ok, imported: [ids], storeIds: [ids] }.",
  inputShape: {
    slug: z.string().describe("The search slug."),
    resultIds: z.array(z.number().int()).min(1).describe("Result ids to import (from get_showroom_search)."),
  },
  annotations: WRITE,
  outputShape: {
    ok: z.boolean(),
    imported: z.array(z.number().int()).optional(),
    storeIds: z.array(z.number().int()).optional(),
    reason: z.string().optional(),
  },
  examples: [
    { title: "Add two picks to the directory", args: { slug: "tile-and-stone-near-livermore", resultIds: [41, 43] } },
  ],
  handler: async (ctx, input) => {
    return importSearchResults(ctx.env, input.slug, input.resultIds);
  },
});
