/**
 * @fileoverview MCP tool — get_showroom_search (Showrooms domain, 0032 D2c-2).
 * Read one discovery search + its current result rows. Read-only; same service as REST.
 */
import { z } from "zod";

import { getSearch } from "@backend/services/showroom/discovery-search";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const getShowroomSearch = defineTool({
  name: "get_showroom_search",
  category: "showrooms",
  title: "Get a discovery search + its results",
  description:
    "Read one discovery search by slug and its current result rows (the latest revision). Each " +
    "result carries id, placeId, name, fullAddress, googleRating, categoryGuess, aiRelevance/" +
    "aiReasoning, distanceM, inDirectory + existingStoreId, isExcluded. Use the result `id`s with " +
    "`import_search_results` / `exclude_search_result`. Returns { search, results } or null-not-found.",
  inputShape: {
    slug: z.string().describe("The search slug (from find_showrooms / list_showroom_searches)."),
  },
  annotations: READ_ONLY,
  outputShape: {
    found: z.boolean(),
    search: looseObject({}).optional(),
    results: z.array(looseObject({})).optional(),
  },
  examples: [{ title: "Open a search", args: { slug: "tile-and-stone-near-livermore" } }],
  handler: async (ctx, input) => {
    const data = await getSearch(ctx.db, input.slug);
    if (!data) return { found: false };
    return { found: true, search: data.search, results: data.results };
  },
});
