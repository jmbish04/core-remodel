import { showroomStores } from "@backend/db";
import { GoogleMapsService } from "@backend/services/google/maps";
import { faviconService } from "@backend/services/favicon";
import {
  resolveStoreGeoPatch,
  runPhotoPipeline,
  type PlacePhotoRef,
} from "@backend/services/showroom/onboarding";
import { getStoreLinksMap, linksToLegacyUrls } from "@backend/utils/showroom-links";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { defineTool, WRITE_IDEMPOTENT } from "../../types";

/**
 * A boolean input that also accepts the stringified "true"/"false" some MCP
 * clients emit — so `fetchHeroes:"true"` is honored rather than rejected.
 */
const boolInput = () =>
  z.preprocess((v) => (typeof v === "string" ? v.trim().toLowerCase() === "true" : v), z.boolean());

export const backfillShowroomMedia = defineTool({
  name: "backfill_showroom_media",
  category: "showrooms",
  title: "Backfill showroom icons, hero images + coordinates",
  description:
    "One-shot maintenance so the directory cards + map are complete for existing showrooms. Per store, it fills " +
    "whatever is missing:\n" +
    "• COORDINATES — if lat/lng are absent it uses the stored Google `placeId`; when there is NO placeId it runs a " +
    "Places TEXT SEARCH by name+address to recover one, then captures lat/lng + region hub. This is what finally " +
    "pins the manually-added stores that have no placeId (and so no map marker). Complements `backfill_showroom_geo`, " +
    "which only helps stores that already have a placeId.\n" +
    "• ICON — hydrates the favicon/logo by scraping the store's website (its WEBSITE link). No Google quota.\n" +
    "• HERO — fetches the store's Google Places photos and runs the Cloudflare Images pipeline (hero = first photo).\n" +
    "Coordinates + icons run by default; heroes are opt-in (`fetchHeroes`) because Places Photo calls are " +
    "quota-metered. Processes up to `limit` stores per call (default 25, max 50) so you can pace spend — re-run until " +
    "`remaining` is 0. Idempotent (already-filled fields are skipped). Returns `unresolved` — stores it still could " +
    "not fill (e.g. no website for an icon, or Places found no match) for manual follow-up.",
  inputShape: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Max stores to process this run (default 25)"),
    fetchCoordinates: boolInput()
      .optional()
      .describe("Recover missing lat/lng via stored placeId or a Places text search (default true)."),
    fetchIcons: boolInput()
      .optional()
      .describe("Hydrate missing favicons/logos from each store's website (default true, no Google quota)."),
    fetchHeroes: boolInput()
      .optional()
      .describe(
        "Fetch missing hero images from Google Places photos (default FALSE — quota-metered Places Photo calls).",
      ),
  },
  annotations: WRITE_IDEMPOTENT,
  outputShape: {
    processed: z.number().int(),
    coordinatesSet: z.number().int(),
    iconsSet: z.number().int(),
    heroesSet: z.number().int(),
    remaining: z.number().int(),
    unresolved: z.array(
      z.object({
        id: z.number().int(),
        name: z.string().nullable(),
        missing: z.array(z.string()),
      }),
    ),
  },
  examples: [
    { title: "Coords + icons (free)", args: {} },
    { title: "Everything incl. heroes, 10/run", args: { fetchHeroes: true, limit: 10 } },
  ],
  handler: async ({ env, db }, input) => {
    const limit = input.limit ?? 25;
    const doCoords = input.fetchCoordinates ?? true;
    const doIcons = input.fetchIcons ?? true;
    const doHeroes = input.fetchHeroes ?? false;

    const all = await db
      .select()
      .from(showroomStores)
      .where(eq(showroomStores.isActive, true))
      .all();

    // Websites live in showroom_store_links now, not on the store row. Fetch them
    // once (getStoreLinksMap chunks the id list internally) so icon-eligibility is
    // known up front and no-website stores don't clog the candidate batch.
    const linkMap = await getStoreLinksMap(
      db,
      all.map((s) => s.id),
    );
    const websiteOf = (id: number) => linksToLegacyUrls(linkMap.get(id) ?? []).websiteUrl;

    const needs = (s: (typeof all)[number]) => {
      const missing: string[] = [];
      if (doCoords && (s.latitude == null || s.longitude == null)) missing.push("coordinates");
      if (doIcons && !s.iconCfImagesUrl && websiteOf(s.id)) missing.push("icon");
      if (doHeroes && !s.heroImageCfImagesUrl) missing.push("hero");
      return missing;
    };

    const candidates = all.filter((s) => needs(s).length > 0);
    const batch = candidates.slice(0, limit);

    if (batch.length === 0) {
      return {
        processed: 0,
        coordinatesSet: 0,
        iconsSet: 0,
        heroesSet: 0,
        remaining: 0,
        unresolved: [],
      };
    }

    const maps = new GoogleMapsService(env);

    for (const s of batch) {
      const website = websiteOf(s.id);
      let placeId = s.placeId;
      let lat = s.latitude;
      let lng = s.longitude;

      // ── Coordinates: stored placeId → else Places text search to recover one.
      if (doCoords && (lat == null || lng == null)) {
        try {
          if (!placeId && s.name) {
            const query = [s.name, s.locationAddress].filter(Boolean).join(" ");
            const results = await maps.placesTextSearchMany(query, {
              maxResults: 1,
              near: s.locationAddress ?? s.locationCity ?? "San Francisco, CA",
            });
            const top = results[0];
            if (top?.placeId) {
              placeId = top.placeId;
              const loc = top.location as { latitude?: number; longitude?: number } | undefined;
              if (typeof loc?.latitude === "number" && typeof loc?.longitude === "number") {
                lat = loc.latitude;
                lng = loc.longitude;
              }
            }
          } else if (placeId) {
            const d = await maps.placeDetails(placeId, undefined, { skipAi: true });
            const loc = d.location as { latitude?: number; longitude?: number } | undefined;
            if (typeof loc?.latitude === "number" && typeof loc?.longitude === "number") {
              lat = loc.latitude;
              lng = loc.longitude;
            }
          }
        } catch {
          // Tolerate quota / lookup failures — the store lands in `unresolved`.
        }

        if (lat != null && lng != null) {
          const geo = await resolveStoreGeoPatch(db, {
            latitude: lat,
            longitude: lng,
            zipCode: s.zipCode,
            locationAddress: s.locationAddress,
            locationCity: s.locationCity,
          });
          const patch: Partial<typeof showroomStores.$inferInsert> = {
            latitude: lat,
            longitude: lng,
            updatedAt: new Date(),
          };
          // Capture a recovered placeId so future enrichment (hero, dedup) works.
          if (placeId && !s.placeId) patch.placeId = placeId;
          if (geo.bayAreaCityId != null && s.bayAreaCityId == null)
            patch.bayAreaCityId = geo.bayAreaCityId;
          if (geo.hubRoute != null && s.hubRoute == null) {
            patch.hubRoute = geo.hubRoute;
            patch.hubName = geo.hubName;
          }
          await db.update(showroomStores).set(patch).where(eq(showroomStores.id, s.id)).run();
        }
      }

      // ── Icon: scrape the favicon/logo from the website (self-updates the row).
      if (doIcons && !s.iconCfImagesUrl && website) {
        try {
          await faviconService.hydrateShowroomIcon(env, s.id, website);
        } catch (err) {
          // hydrateShowroomIcon swallows its own errors, but guard the loop anyway
          // so one unreachable site can't abort the rest of the batch.
          console.error(`[backfill_showroom_media] icon failed for store ${s.id}:`, err);
        }
      }

      // ── Hero: Google Places photos → Cloudflare Images pipeline.
      if (doHeroes && !s.heroImageCfImagesUrl && placeId) {
        try {
          const d = await maps.placeDetails(placeId, undefined, { skipAi: true });
          const photos = ((d.photos as PlacePhotoRef[] | undefined) ?? []).slice(0, 5);
          if (photos.length > 0) await runPhotoPipeline(env, s.id, photos);
        } catch (err) {
          console.error(`[backfill_showroom_media] hero failed for store ${s.id}:`, err);
        }
      }
    }

    // Re-read the batch to count what actually landed + collect leftovers. One
    // chunked inArray (D1 caps a query at 100 bound params) rather than a select
    // per store.
    const beforeById = new Map(batch.map((s) => [s.id, s]));
    const ids = batch.map((s) => s.id);
    const D1_IN_CHUNK = 90;
    const updatedRows: Array<{
      id: number;
      name: string | null;
      latitude: number | null;
      longitude: number | null;
      iconCfImagesUrl: string | null;
      heroImageCfImagesUrl: string | null;
    }> = [];
    for (let i = 0; i < ids.length; i += D1_IN_CHUNK) {
      const rows = await db
        .select({
          id: showroomStores.id,
          name: showroomStores.name,
          latitude: showroomStores.latitude,
          longitude: showroomStores.longitude,
          iconCfImagesUrl: showroomStores.iconCfImagesUrl,
          heroImageCfImagesUrl: showroomStores.heroImageCfImagesUrl,
        })
        .from(showroomStores)
        .where(inArray(showroomStores.id, ids.slice(i, i + D1_IN_CHUNK)))
        .all();
      updatedRows.push(...rows);
    }

    let coordinatesSet = 0;
    let iconsSet = 0;
    let heroesSet = 0;
    const unresolved: Array<{ id: number; name: string | null; missing: string[] }> = [];

    for (const row of updatedRows) {
      const before = beforeById.get(row.id);
      if (!before) continue;

      if (doCoords && (before.latitude == null || before.longitude == null) && row.latitude != null)
        coordinatesSet++;
      if (doIcons && !before.iconCfImagesUrl && row.iconCfImagesUrl) iconsSet++;
      if (doHeroes && !before.heroImageCfImagesUrl && row.heroImageCfImagesUrl) heroesSet++;

      const stillMissing: string[] = [];
      if (doCoords && (row.latitude == null || row.longitude == null)) stillMissing.push("coordinates");
      if (doIcons && !row.iconCfImagesUrl && websiteOf(row.id)) stillMissing.push("icon");
      if (doHeroes && !row.heroImageCfImagesUrl) stillMissing.push("hero");
      if (stillMissing.length > 0)
        unresolved.push({ id: row.id, name: row.name, missing: stillMissing });
    }

    return {
      processed: batch.length,
      coordinatesSet,
      iconsSet,
      heroesSet,
      remaining: Math.max(0, candidates.length - batch.length),
      unresolved,
    };
  },
});
