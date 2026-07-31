/**
 * @fileoverview MCP tool — find_showrooms (Showrooms domain, 0032 D2c-2).
 *
 * The voice/chat twin of the finder UI: run a worker-orchestrated discovery search
 * (0022 §14.2). The model may hand in its own `aiResults`; the worker adds a Google
 * Places sweep (cost-gated — AI-only when the Places quota is spent), dedupes against
 * the directory + not-interested list, ranks with Gemini, and persists a shareable
 * numbered revision. Goes through the SAME `discovery-search` service the REST route
 * uses (AGENTS.md parity). Pass a `slug` to refine an existing search in place.
 */
import { z } from "zod";

import { findShowrooms } from "@backend/services/showroom/discovery-search";

import { looseObject } from "../../schemas";
import { defineTool, WRITE } from "../../types";

export const findShowroomsTool = defineTool({
  name: "find_showrooms",
  category: "showrooms",
  title: "Find remodel showrooms near a location",
  description:
    "Run a discovery search for remodel showrooms near a place and persist it as a shareable slug. " +
    "The worker does the Google Places sweep (only when `usePlaces` is set AND the Places quota is " +
    "under budget — otherwise it degrades to AI-only), dedupes against the directory + not-interested " +
    "list, ranks with Gemini, and writes a numbered revision. You may pass `aiResults` (places you " +
    "already found) to merge in. Pass a `slug` to refine an existing search (adds a new revision). " +
    "Use `list_showroom_searches` / `get_showroom_search` to read results, `import_search_results` to " +
    "add picks to the directory, and `exclude_search_result` to hide one for good. Returns " +
    "{ ok, slug, url, revision, count, summary, usedPlaces, results, excluded }.",
  inputShape: {
    near: z
      .string()
      .optional()
      .describe("Where to search: a 'lat,lng' point, an area name, or 'current-location'."),
    radiusM: z.number().optional().describe("Search radius in metres (advisory)."),
    query: z.string().optional().describe("Optional text query; omit for a broad remodel-showroom sweep."),
    broad: z.boolean().optional().describe("Force a broad sweep (any remodel showroom)."),
    likeStoreId: z.number().int().optional().describe("Bias toward showrooms like this store id."),
    excludeCategories: z.array(z.string()).optional().describe("Drop results in these categories."),
    excludeStoreIds: z.array(z.number().int()).optional().describe("Hide these already-known store ids."),
    usePlaces: z.boolean().optional().describe("Run the billed Places sweep (default true)."),
    aiResults: z
      .array(
        z.object({
          placeId: z.string().nullish(),
          name: z.string(),
          fullAddress: z.string().nullish(),
          latitude: z.number().nullish(),
          longitude: z.number().nullish(),
          category: z.string().nullish(),
          reasoning: z.string().nullish(),
          website: z.string().nullish(),
          phone: z.string().nullish(),
        }),
      )
      .optional()
      .describe("Candidates you already found (merged with the Places sweep)."),
    slug: z.string().optional().describe("Refine an existing search slug in place (adds a revision)."),
    title: z.string().optional().describe("Human label for a new search."),
    originConversation: z.string().optional().describe("Chat/session ref for the receipts."),
  },
  annotations: WRITE,
  outputShape: {
    ok: z.boolean(),
    slug: z.string(),
    url: z.string(),
    revision: z.number().int(),
    count: z.number().int(),
    summary: z.string(),
    usedPlaces: z.boolean(),
    results: z.array(looseObject({})),
    excluded: z.array(looseObject({})),
  },
  examples: [
    { title: "Showrooms near Livermore", args: { near: "Livermore, CA", query: "tile and stone" } },
    { title: "Broad sweep at my current location", args: { near: "current-location", broad: true } },
  ],
  handler: async (ctx, input) => {
    return findShowrooms(ctx.env, { ...input, origin: "mcp" });
  },
});
