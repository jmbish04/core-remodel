import { brands } from "@backend/db";
import { z } from "zod";

import { matchesQuery, paginate } from "../../format";
import { looseObject, pageOutput } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

/** Shared Zod output shape for a compact brand-list DTO (mirrors `brandListDto`). */
const brandListOutputShape = looseObject({
  id: z.number().int(),
  name: z.string(),
  pricePoint: z.string().nullable(),
  onlineRating: z.number().nullable(),
  userRating: z.number().nullable(),
  websiteUrl: z.string().nullable(),
});

/** Shape a brand row for compact list output. */
function brandListDto(b: typeof brands.$inferSelect) {
  return {
    id: b.id,
    name: b.name,
    pricePoint: b.pricePoint,
    onlineRating: b.onlineRating,
    userRating: b.userRating,
    websiteUrl: b.websiteUrl,
  };
}

export const listBrands = defineTool({
    name: "list_brands",
    category: "brands",
    title: "List brands",
    description:
      "List brands from the global registry (id, name, pricePoint, onlineRating, userRating, website). Optional free-text `q` filters by name/description. Use a brand's `id` as the target for get_brand, update_brand, and the showroom-link tools.",
    inputShape: {
      q: z.string().optional().describe("Free-text filter over brand name / description"),
      limit: z.number().int().positive().max(200).optional(),
      offset: z.number().int().min(0).optional(),
    },
    annotations: READ_ONLY,
    outputShape: { ...pageOutput(brandListOutputShape) },
    examples: [
      { title: "All brands", args: {} },
      { title: "Find Waterworks", args: { q: "waterworks" } },
    ],
    handler: async ({ db }, input) => {
      const all = await db.select().from(brands).all();
      const filtered = input.q
        ? all.filter((b) => matchesQuery([b.name, b.description], input.q as string))
        : all;
      return paginate(filtered.map(brandListDto), input.limit ?? 50, input.offset ?? 0);
    },
  });
