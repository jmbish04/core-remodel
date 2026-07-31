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
      .max(200)
      .optional()
      .describe("Where to search: a 'lat,lng' point, an area name, or 'current-location'."),
    radiusM: z
      .number()
      .min(1)
      .max(100_000)
      .optional()
      .describe("Search radius in metres (advisory; 1..100000)."),
    query: z.string().max(300).optional().describe("Optional text query; omit for a broad remodel-showroom sweep."),
    broad: z.boolean().optional().describe("Force a broad sweep (any remodel showroom)."),
    likeStoreId: z.number().int().optional().describe("Bias toward showrooms like this store id."),
    excludeCategories: z.array(z.string().max(120)).max(50).optional().describe("Drop results in these categories."),
    excludeStoreIds: z.array(z.number().int()).max(200).optional().describe("Hide these already-known store ids."),
    usePlaces: z.boolean().default(true).describe("Run the billed Places sweep (default true)."),
    aiResults: z
      .array(
        z.object({
          placeId: z.string().max(300).nullish(),
          name: z.string().max(300),
          fullAddress: z.string().max(400).nullish(),
          latitude: z.number().nullish(),
          longitude: z.number().nullish(),
          category: z.string().max(120).nullish(),
          reasoning: z.string().max(1000).nullish(),
          website: z
            .string()
            .max(500)
            .regex(/^https?:\/\//i, "website must be an http(s) URL")
            .nullish(),
          phone: z.string().max(60).nullish(),
        }),
      )
      .max(50)
      .optional()
      .describe("Candidates you already found (merged with the Places sweep)."),
    slug: z.string().max(128).optional().describe("Refine an existing search slug in place (adds a revision)."),
    title: z.string().max(200).optional().describe("Human label for a new search."),
    originConversation: z.string().max(200).optional().describe("Chat/session ref for the receipts."),
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
