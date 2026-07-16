import { showroomStores } from "@backend/db";
import { GoogleMapsService } from "@backend/services/google/maps";
import { inArray } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";

import { rethrowMapsError } from "./_shared";

export const searchShowrooms = defineTool({
  name: "search_showrooms",
  category: "showrooms",
  title: "Search for showrooms (Google Places)",
  description:
    "Discover candidate showrooms via Google Places text search — the kickstart for showroom research. " +
    "Give a free-text `query` ('stone slab countertop showroom', 'European kitchen cabinetry'); optionally bias " +
    "with `near` (a city like 'San Francisco, CA' or a 'lat,lng' pair), cap with `maxResults` (default 10, max 20), " +
    "or narrow with a Places `includedType`. Returns candidate cards (placeId, name, address, rating, phone, " +
    "website, primaryType, location) with each flagged `alreadyInDb` + `existingShowroomId` so you can skip dupes. " +
    "This is READ-ONLY discovery — nothing is saved. To persist a pick, call import_showroom_from_place (or " +
    "create_showroom). Hits an external, quota-metered API; surfaces MAPS_QUOTA_EXCEEDED clearly.",
  inputShape: {
    query: z.string().min(1).describe("Free-text place search (required)"),
    near: z
      .string()
      .optional()
      .describe("Location bias: a city name ('San Francisco, CA') or a 'lat,lng' pair"),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Number of candidates to return (default 10, hard cap 20)"),
    includedType: z
      .string()
      .optional()
      .describe("Optional Google Places primary type filter (e.g. 'home_goods_store')"),
  },
  annotations: { ...READ_ONLY, openWorldHint: true },
  outputShape: {
    query: z.string(),
    near: z.string().nullable(),
    count: z.number().int(),
    candidates: z.array(
      looseObject({
        placeId: z.string(),
        name: z.string().nullable(),
        alreadyInDb: z.boolean(),
        existingShowroomId: z.number().int().nullable(),
      }),
    ),
  },
  examples: [
    {
      title: "Stone/slab near SF",
      args: { query: "stone slab countertop showroom", near: "San Francisco, CA", maxResults: 12 },
    },
    { title: "European cabinetry", args: { query: "European kitchen cabinetry Bay Area" } },
  ],
  handler: async ({ env, db }, input) => {
    const query = input.query?.trim();
    if (!query) toolError("`query` is required and cannot be empty.");

    let candidates: Awaited<ReturnType<GoogleMapsService["placesTextSearchMany"]>>;
    try {
      candidates = await new GoogleMapsService(env).placesTextSearchMany(query, {
        maxResults: input.maxResults,
        near: input.near,
        includedType: input.includedType,
      });
    } catch (err) {
      rethrowMapsError(err);
    }

    // Cross-reference existing stores by placeId so the agent can skip dupes.
    const placeIds = candidates.map((c) => c.placeId);
    const existing =
      placeIds.length > 0
        ? await db
            .select({ id: showroomStores.id, placeId: showroomStores.placeId })
            .from(showroomStores)
            .where(inArray(showroomStores.placeId, placeIds))
            .all()
        : [];
    const byPlaceId = new Map(existing.map((s) => [s.placeId, s.id]));

    return {
      query,
      near: input.near ?? null,
      count: candidates.length,
      candidates: candidates.map((c) => {
        const existingShowroomId = byPlaceId.get(c.placeId);
        return {
          placeId: c.placeId,
          name: c.displayName,
          address: c.formattedAddress,
          rating: c.rating,
          userRatingCount: c.userRatingCount,
          phone: c.nationalPhoneNumber,
          website: c.websiteUri,
          primaryType: c.primaryType,
          location: c.location,
          alreadyInDb: existingShowroomId != null,
          existingShowroomId: existingShowroomId ?? null,
        };
      }),
    };
  },
});
