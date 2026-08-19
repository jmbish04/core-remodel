/**
 * @fileoverview MCP tool — finalize_showroom_search (Showrooms domain, 0032 D2c-2).
 * Mark a discovery search final (done). Idempotent; same service as REST.
 */
import { z } from "zod";

import { finalizeSearch } from "@backend/services/showroom/discovery-search";

import { defineTool, WRITE_IDEMPOTENT } from "../../types";

export const finalizeShowroomSearch = defineTool({
  name: "finalize_showroom_search",
  category: "showrooms",
  title: "Finalize a discovery search",
  description:
    "Mark a discovery search 'final' (done — no more refines expected). A fresh slug is pending " +
    "(ready, not final) until this is called. Idempotent. Returns { ok, reason? }.",
  inputShape: { slug: z.string().describe("The search slug to finalize.") },
  annotations: WRITE_IDEMPOTENT,
  outputShape: { ok: z.boolean(), reason: z.string().optional() },
  examples: [{ title: "Finalize a search", args: { slug: "tile-and-stone-near-livermore" } }],
  handler: async (ctx, input) => {
    return finalizeSearch(ctx.db, input.slug);
  },
});
