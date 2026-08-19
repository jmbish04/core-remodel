/**
 * @fileoverview MCP tool — add_showroom_exclusion (Showrooms domain, 0032 D2c-2).
 * Add a not-interested place to the exclusion list. Idempotent by place_id; same service as REST.
 */
import { z } from "zod";

import { addExclusion } from "@backend/services/showroom/discovery-search";

import { defineTool, WRITE_IDEMPOTENT } from "../../types";

export const addShowroomExclusion = defineTool({
  name: "add_showroom_exclusion",
  category: "showrooms",
  title: "Add a place to the not-interested list",
  description:
    "Add a place to the exclusion list so it's auto-hidden from every future discovery sweep + " +
    "proximity scan. Provide a `placeId` (the idempotency key — re-adding returns the same row) OR at " +
    "least a `name` (fuzzy name+address fallback). Optional address, category, and a reason note " +
    "(markdown; html render cache sanitized on write). Returns { ok, exclusionId }.",
  inputShape: {
    placeId: z.string().optional().describe("Google place_id — the preferred, idempotent match key."),
    name: z.string().optional().describe("Business name (required if no placeId)."),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    locationCity: z.string().optional(),
    locationState: z.string().optional(),
    locationZipCode: z.string().optional(),
    category: z.string().optional().describe("Best-guess category."),
    reasonMarkdown: z.string().optional().describe("Why it's excluded (markdown)."),
    reasonHtml: z.string().optional().describe("Pre-rendered html (sanitized on write; optional)."),
  },
  annotations: WRITE_IDEMPOTENT,
  outputShape: { ok: z.boolean(), exclusionId: z.number().int() },
  examples: [
    { title: "Never surface this place", args: { placeId: "ChIJxxxx", name: "Generic Mattress Outlet", category: "mattress" } },
  ],
  handler: async (ctx, input) => {
    return addExclusion(ctx.db, { ...input, source: "manual" });
  },
});
