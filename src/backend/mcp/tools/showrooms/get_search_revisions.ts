/**
 * @fileoverview MCP tool — get_search_revisions (Showrooms domain, 0032 D2c-2).
 * The numbered revision history of a discovery search. Read-only; same service as REST.
 */
import { z } from "zod";

import { getSearchRevisions } from "@backend/services/showroom/discovery-search";

import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

export const getSearchRevisions_ = defineTool({
  name: "get_search_revisions",
  category: "showrooms",
  title: "Get a discovery search's revision history",
  description:
    "List the numbered revisions of a discovery search (each refine adds one), newest first — so you " +
    "can cite 'revision N'. Each carries revisionNumber, source (places|ai|mixed), usedPlaces, " +
    "changeNote, createdAt. Returns { count, revisions } or found:false when the slug is unknown.",
  inputShape: { slug: z.string().describe("The search slug.") },
  annotations: READ_ONLY,
  outputShape: {
    found: z.boolean(),
    count: z.number().int().optional(),
    revisions: z.array(looseObject({})).optional(),
  },
  examples: [{ title: "Revisions of a search", args: { slug: "tile-and-stone-near-livermore" } }],
  handler: async (ctx, input) => {
    const revisions = await getSearchRevisions(ctx.db, input.slug);
    if (revisions == null) return { found: false };
    return { found: true, count: revisions.length, revisions };
  },
});
