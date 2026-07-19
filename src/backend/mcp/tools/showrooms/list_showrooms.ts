import { eq } from "drizzle-orm";
import { showroomStores } from "@backend/db";
import { getStoreLinksMap, linksToLegacyUrls } from "@backend/utils/showroom-links";
import { z } from "zod";

import { matchesQuery, paginate } from "../../format";
import { looseObject, pageOutput } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

/** Shape a store row into a compact list row for `list_showrooms`. The website
 *  is derived from the store's WEBSITE link (URLs live in showroom_store_links,
 *  no longer on the store row). */
function storeListDto(
  s: typeof showroomStores.$inferSelect,
  website: string | null,
) {
  return {
    id: s.id,
    name: s.name,
    pricePoint: s.pricePoint,
    address: s.locationAddress,
    zipCode: s.zipCode,
    phone: s.phoneNumber,
    website,
    rating: s.rating,
    isAppointmentOnly: s.isAppointmentOnly,
  };
}

export const listShowrooms = defineTool({
  name: "list_showrooms",
  category: "showrooms",
  title: "List showrooms",
  description:
    "List showroom store locations as compact rows (id, name, pricePoint, address, phone, website, rating). Optional filters: free-text `q` over name/description/address, exact `pricePoint` ($..$$$$), and `isAppointmentOnly`. Use a store's `id` as the target for get_showroom and every write tool.",
  inputShape: {
    q: z
      .string()
      .optional()
      .describe("Free-text filter over store name / description / address"),
    pricePoint: z
      .enum(["$", "$$", "$$$", "$$$$"])
      .optional()
      .describe("Exact price-point tier filter"),
    isAppointmentOnly: z
      .boolean()
      .optional()
      .describe("Only stores flagged appointment-only (true) or walk-in (false)"),
    limit: z.number().int().positive().max(200).optional(),
    offset: z.number().int().min(0).optional(),
  },
  annotations: READ_ONLY,
  outputShape: {
    ...pageOutput(
      looseObject({
        id: z.number().int(),
        name: z.string().nullable(),
        pricePoint: z.string().nullable(),
        address: z.string().nullable(),
        rating: z.number().nullable(),
      }),
    ),
  },
  examples: [
    { title: "All showrooms", args: {} },
    { title: "Affordable tile places", args: { q: "tile", pricePoint: "$$" } },
  ],
  handler: async ({ db }, input) => {
    // Soft-deleted stores never surface to the agent.
    const all = await db
      .select()
      .from(showroomStores)
      .where(eq(showroomStores.isActive, true))
      .all();
    const filtered = all.filter((s) => {
      if (input.q && !matchesQuery([s.name, s.description, s.locationAddress], input.q)) {
        return false;
      }
      if (input.pricePoint && s.pricePoint !== input.pricePoint) return false;
      if (input.isAppointmentOnly != null && s.isAppointmentOnly !== input.isAppointmentOnly) {
        return false;
      }
      return true;
    });
    const linksMap = await getStoreLinksMap(db, filtered.map((s) => s.id));
    return paginate(
      filtered.map((s) =>
        storeListDto(s, linksToLegacyUrls(linksMap.get(s.id) ?? []).websiteUrl),
      ),
      input.limit ?? 50,
      input.offset ?? 0,
    );
  },
});
