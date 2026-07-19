import { showroomStores } from "@backend/db";
import { GoogleMapsService } from "@backend/services/google/maps";
import { resolveStoreGeoPatch } from "@backend/services/showroom/onboarding";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { defineTool, WRITE_IDEMPOTENT } from "../../types";

export const backfillShowroomGeo = defineTool({
  name: "backfill_showroom_geo",
  category: "showrooms",
  title: "Backfill showroom coordinates + regions",
  description:
    "One-time maintenance for existing showrooms so the directory REGION filters (East Bay / South Bay / Peninsula / " +
    "North Bay / SF) and the individual map markers are complete. For every store that is missing its captured " +
    "region hub it derives one from the stored address / ZIP at NO API cost; for stores that also lack coordinates " +
    "but have a Google `placeId` it fetches the Place location (one quota-metered Places call each, no Gemini) and " +
    "captures lat/lng + region. Processes up to `limit` stores per call (default 25) so you can pace Places spend — " +
    "re-run until `remaining` is 0. Idempotent: rows that already have a region/coordinates are skipped. Run this " +
    "once after upgrading, or whenever showrooms were added without a placeId-driven import.",
  inputShape: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Max stores to process this run (default 25)"),
    fetchCoordinates: z
      .boolean()
      .optional()
      .describe(
        "Fetch missing coordinates from Google Places by placeId (default true). " +
          "Set false to only derive regions from stored addresses with zero API calls.",
      ),
  },
  annotations: WRITE_IDEMPOTENT,
  outputShape: {
    processed: z.number().int(),
    regionsSet: z.number().int(),
    citiesSet: z.number().int(),
    coordinatesSet: z.number().int(),
    remaining: z.number().int(),
  },
  examples: [
    { title: "Full backfill (25/run)", args: {} },
    { title: "Regions only, no Places calls", args: { fetchCoordinates: false, limit: 100 } },
  ],
  handler: async ({ env, db }, input) => {
    const limit = input.limit ?? 25;
    const fetchCoordinates = input.fetchCoordinates ?? true;

    const all = await db
      .select()
      .from(showroomStores)
      .where(eq(showroomStores.isActive, true))
      .all();
    // Candidates: anything missing coordinates, a region hub, OR the city FK.
    // The city FK is the field intake historically never set, so this also
    // re-homes rows that were stamped with a wrong centroid-derived hub (e.g. a
    // Peninsula store mislabeled "SF Design District") onto the correct city.
    const candidates = all.filter(
      (s) =>
        s.hubRoute == null || s.latitude == null || s.longitude == null || s.bayAreaCityId == null,
    );
    const batch = candidates.slice(0, limit);

    const maps = new GoogleMapsService(env);
    let regionsSet = 0;
    let citiesSet = 0;
    let coordinatesSet = 0;

    for (const s of batch) {
      let lat = s.latitude;
      let lng = s.longitude;

      if ((lat == null || lng == null) && fetchCoordinates && s.placeId) {
        try {
          const d = await maps.placeDetails(s.placeId, undefined, { skipAi: true });
          const loc = d.location as { latitude?: number; longitude?: number } | undefined;
          if (typeof loc?.latitude === "number" && typeof loc?.longitude === "number") {
            lat = loc.latitude;
            lng = loc.longitude;
            coordinatesSet++;
          }
        } catch {
          // Tolerate quota / lookup failures — region derivation below still runs.
        }
      }

      const geo = await resolveStoreGeoPatch(db, {
        latitude: lat,
        longitude: lng,
        zipCode: s.zipCode,
        locationAddress: s.locationAddress,
        locationCity: s.locationCity,
      });

      const patch: Partial<typeof showroomStores.$inferInsert> = {};
      if (geo.latitude != null && s.latitude == null) patch.latitude = geo.latitude;
      if (geo.longitude != null && s.longitude == null) patch.longitude = geo.longitude;

      // A resolved city is authoritative: set the FK and align the hub to it,
      // correcting any earlier centroid-guessed hub. Otherwise just fill a
      // missing hub from the coarse fallback.
      const cityChanged = geo.bayAreaCityId != null && geo.bayAreaCityId !== s.bayAreaCityId;
      const hubMismatch =
        geo.bayAreaCityId != null && geo.hubRoute != null && geo.hubRoute !== s.hubRoute;
      if (cityChanged) {
        patch.bayAreaCityId = geo.bayAreaCityId;
        citiesSet++;
      }
      if (cityChanged || hubMismatch || (s.hubRoute == null && geo.hubRoute != null)) {
        patch.hubRoute = geo.hubRoute;
        patch.hubName = geo.hubName;
        regionsSet++;
      }
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = new Date();
        await db.update(showroomStores).set(patch).where(eq(showroomStores.id, s.id)).run();
      }
    }

    return {
      processed: batch.length,
      regionsSet,
      citiesSet,
      coordinatesSet,
      remaining: Math.max(0, candidates.length - batch.length),
    };
  },
});
