/**
 * @fileoverview MCP tool — whats_near_me (Showrooms domain).
 *
 * The on-the-road discovery primitive for an in-car AI: given where the driver
 * is right now, rank the REGISTERED showrooms around them by distance and give
 * a compass bearing to each ("Ferguson is 1.2 mi to your NW"). Optionally sweep
 * Google Places (quota-gated) for nearby spots that are NOT yet in the directory,
 * so the assistant can surface a walk-in the user hasn't catalogued.
 *
 * Location resolution mirrors get_user_location: explicit coords win, else the
 * live Tesla GPS, else the last-known phone fix. Showroom coordinates are read
 * through `loadShowroomCoords` — the single seam that survives the anticipated
 * move of location data off `showroom_stores` (see docs/0023).
 */
import { deviceLocation } from "@backend/db";
import { classifyBayAreaRegion } from "@backend/lib/bay-area-region";
import {
  compassFromBearing,
  haversineMeters,
  initialBearing,
} from "@backend/services/drive-geo-match";
import { GoogleMapsService } from "@backend/services/google/maps";
import { getLocation as getTeslaLocation } from "@backend/services/tesla";
import { desc } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, READ_ONLY } from "../../types";
import { loadShowroomCoords } from "./_shared";

const METERS_PER_MILE = 1609.344;
/** Default search radius: ~10 miles, a reasonable "on the way" detour. */
const DEFAULT_RADIUS_M = 16_093;
/** Places Nearby caps at 50 km; keep our own cap the same. */
const MAX_RADIUS_M = 50_000;
/** A Places result within this distance of a registered showroom is treated as the same place. */
const UNDISCOVERED_DEDUPE_M = 75;

const miles = (m: number): number => Math.round((m / METERS_PER_MILE) * 10) / 10;

export const whatsNearMe = defineTool({
  name: "whats_near_me",
  category: "showrooms",
  title: "Which showrooms are near the driver right now",
  description:
    "Rank the REGISTERED showrooms around the driver's current position by distance, each with a compass bearing " +
    "(e.g. 'NW') and miles away — the tool for 'what's near me?' / 'anything worth stopping at on my way?'. " +
    "Location is resolved automatically (live Tesla GPS, else the last phone fix) unless you pass explicit " +
    "`latitude`/`longitude`. Set `includeUndiscovered: true` to ALSO sweep Google Places (quota-gated) for nearby " +
    "spots not yet in the directory. Distances are straight-line (haversine), not driving distance.",
  inputShape: {
    latitude: z
      .number()
      .min(-90)
      .max(90)
      .optional()
      .describe("Override latitude. Omit to auto-resolve from the car/phone."),
    longitude: z
      .number()
      .min(-180)
      .max(180)
      .optional()
      .describe("Override longitude. Omit to auto-resolve from the car/phone."),
    radiusMeters: z
      .number()
      .int()
      .min(100)
      .max(MAX_RADIUS_M)
      .optional()
      .describe(`Search radius in metres (default ${DEFAULT_RADIUS_M} ≈ 10 mi, max ${MAX_RADIUS_M}).`),
    limit: z
      .number()
      .int()
      .min(1)
      .max(25)
      .optional()
      .describe("Max registered showrooms to return (default 10)."),
    includeUndiscovered: z
      .boolean()
      .optional()
      .describe("Also return nearby Google Places not yet in the directory (uses the Places quota)."),
  },
  annotations: READ_ONLY,
  outputShape: {
    origin: z.object({
      source: z.enum(["explicit", "tesla", "phone"]),
      latitude: z.number(),
      longitude: z.number(),
      heading: z.number().nullable(),
      region: z.string().nullable(),
    }),
    radiusMeters: z.number(),
    showrooms: z.array(
      z.object({
        id: z.number(),
        name: z.string(),
        distanceMeters: z.number(),
        distanceMiles: z.number(),
        bearing: z.number(),
        compass: z.string().nullable(),
        address: z.string().nullable(),
        hubName: z.string().nullable(),
      }),
    ),
    undiscovered: z.array(
      z.object({
        placeId: z.string(),
        name: z.string().nullable(),
        address: z.string().nullable(),
        distanceMeters: z.number(),
        distanceMiles: z.number(),
        bearing: z.number(),
        compass: z.string().nullable(),
        rating: z.number().nullable(),
        primaryType: z.string().nullable(),
      }),
    ),
    note: z.string(),
  },
  examples: [
    { title: "What showrooms are near me?", args: {} },
    { title: "Anything undiscovered within 5 miles?", args: { radiusMeters: 8047, includeUndiscovered: true } },
  ],
  handler: async ({ env, db }, input) => {
    const radiusMeters = input.radiusMeters ?? DEFAULT_RADIUS_M;
    const limit = input.limit ?? 10;

    // ── Resolve the origin: explicit → live Tesla GPS → last phone fix ──────
    let origin: {
      source: "explicit" | "tesla" | "phone";
      latitude: number;
      longitude: number;
      heading: number | null;
    } | null = null;

    if (input.latitude != null && input.longitude != null) {
      origin = { source: "explicit", latitude: input.latitude, longitude: input.longitude, heading: null };
    } else {
      const tesla = await getTeslaLocation(env).catch(() => null);
      if (tesla) {
        origin = {
          source: "tesla",
          latitude: tesla.latitude,
          longitude: tesla.longitude,
          heading: tesla.heading ?? null,
        };
      } else {
        const [device] = await db
          .select()
          .from(deviceLocation)
          .orderBy(desc(deviceLocation.capturedAt))
          .limit(1);
        if (device) {
          origin = {
            source: "phone",
            latitude: device.latitude,
            longitude: device.longitude,
            heading: null,
          };
        }
      }
    }

    if (!origin) {
      toolError(
        "Couldn't determine where the driver is — no explicit coordinates, no live Tesla GPS, and no recent phone " +
          "fix. Ask the user to open the showroom directory and allow location, or pass latitude/longitude.",
      );
    }

    const from = { lat: origin.latitude, lng: origin.longitude };
    const region =
      classifyBayAreaRegion({ latitude: origin.latitude, longitude: origin.longitude })?.name ?? null;

    // ── Registered showrooms within radius, nearest first ───────────────────
    const coords = await loadShowroomCoords(db);
    const showrooms = coords
      .map((s) => {
        const distanceMeters = Math.round(haversineMeters(from, { lat: s.latitude, lng: s.longitude }));
        const bearing = Math.round(initialBearing(from, { lat: s.latitude, lng: s.longitude }));
        return {
          id: s.id,
          name: s.name,
          distanceMeters,
          distanceMiles: miles(distanceMeters),
          bearing,
          compass: compassFromBearing(bearing),
          address: s.address,
          hubName: s.hubName,
        };
      })
      .filter((s) => s.distanceMeters <= radiusMeters)
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, limit);

    // ── Optional Places sweep for undiscovered nearby spots ─────────────────
    let undiscovered: Array<{
      placeId: string;
      name: string | null;
      address: string | null;
      distanceMeters: number;
      distanceMiles: number;
      bearing: number;
      compass: string | null;
      rating: number | null;
      primaryType: string | null;
    }> = [];
    let placesBlocked = false;

    if (input.includeUndiscovered) {
      const places = await new GoogleMapsService(env)
        .placesNearby(origin.latitude, origin.longitude, radiusMeters, { maxResults: 20 })
        .catch(() => [] as Awaited<ReturnType<GoogleMapsService["placesNearby"]>>);
      // An empty result can mean "nothing there" OR "quota blocked" — the method
      // logs the block and returns []. Flag the possibility in the note rather
      // than implying the area is barren.
      placesBlocked = places.length === 0;

      undiscovered = places
        .filter((p) => p.location != null)
        .filter(
          // Drop anything that coincides with a showroom we already track.
          (p) =>
            !coords.some(
              (s) =>
                haversineMeters(
                  { lat: p.location!.latitude, lng: p.location!.longitude },
                  { lat: s.latitude, lng: s.longitude },
                ) <= UNDISCOVERED_DEDUPE_M,
            ),
        )
        .map((p) => {
          const to = { lat: p.location!.latitude, lng: p.location!.longitude };
          const distanceMeters = Math.round(haversineMeters(from, to));
          const bearing = Math.round(initialBearing(from, to));
          return {
            placeId: p.placeId,
            name: p.displayName,
            address: p.formattedAddress,
            distanceMeters,
            distanceMiles: miles(distanceMeters),
            bearing,
            compass: compassFromBearing(bearing),
            rating: p.rating,
            primaryType: p.primaryType,
          };
        })
        .filter((p) => p.distanceMeters <= radiusMeters)
        .sort((a, b) => a.distanceMeters - b.distanceMeters);
    }

    const originWord =
      origin.source === "tesla"
        ? "the live Tesla GPS"
        : origin.source === "phone"
          ? "the last-known phone fix"
          : "the supplied coordinates";
    let note = `${showrooms.length} registered showroom${showrooms.length === 1 ? "" : "s"} within ${miles(radiusMeters)} mi of ${originWord}.`;
    if (input.includeUndiscovered) {
      note += placesBlocked
        ? " No undiscovered Places returned — either none nearby or the Places quota is exhausted (check the Maps usage dashboard)."
        : ` ${undiscovered.length} nearby Place${undiscovered.length === 1 ? "" : "s"} not yet in the directory.`;
    }

    return {
      origin: { ...origin, region },
      radiusMeters,
      showrooms,
      undiscovered,
      note,
    };
  },
});
