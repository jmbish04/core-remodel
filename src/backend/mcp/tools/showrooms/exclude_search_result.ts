/**
 * @fileoverview MCP tool — exclude_search_result (Showrooms domain, 0032 D2c-2).
 * Hide one discovery result + add a permanent exclusion. Same service as REST.
 */
import { z } from "zod";

import { excludeSearchResult } from "@backend/services/showroom/discovery-search";

import { defineTool, WRITE } from "../../types";

export const excludeSearchResultTool = defineTool({
  name: "exclude_search_result",
  category: "showrooms",
  title: "Exclude a discovery result (never show it again)",
  description:
    "Hide one result off a discovery search and add a permanent `showroom_exclusions` row so the same " +
    "place never resurfaces in any future discovery sweep or proximity scan. Optional reason note " +
    "(markdown; the html render cache is sanitized on write). Idempotent by place_id. Get the result " +
    "id from `get_showroom_search`. Returns { ok, exclusionId?, reason? }.",
  inputShape: {
    slug: z.string().describe("The search slug."),
    resultId: z.number().int().describe("The result id to exclude (from get_showroom_search)."),
    reasonMarkdown: z.string().optional().describe("Why you're not interested (markdown)."),
    reasonHtml: z.string().optional().describe("Pre-rendered html (sanitized on write; optional)."),
    category: z.string().optional().describe("Category to record on the exclusion."),
  },
  annotations: WRITE,
  outputShape: { ok: z.boolean(), exclusionId: z.number().int().optional(), reason: z.string().optional() },
  examples: [
    {
      title: "Not interested — it's appointment-only",
      args: { slug: "tile-and-stone-near-livermore", resultId: 42, reasonMarkdown: "Appointment only, trade accounts." },
    },
  ],
  handler: async (ctx, input) => {
    return excludeSearchResult(ctx.env, input.slug, input.resultId, {
      reasonMarkdown: input.reasonMarkdown ?? null,
      reasonHtml: input.reasonHtml ?? null,
      category: input.category ?? null,
    });
  },
});
