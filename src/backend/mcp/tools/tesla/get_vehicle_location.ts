/**
 * @fileoverview MCP tool — get_vehicle_location (Tesla domain).
 *
 * The enriched "where is the car" primitive for an in-car AI assistant. Beyond
 * raw coordinates it returns:
 *   - `heading` + `headingCompass` — which way the car faces (when Tessie reports it),
 *   - a resolved street `address` — Tessie's own when present, else a quota-gated
 *     reverse-geocode (Geocoding SKU) that degrades to null rather than billing
 *     past the free tier,
 *   - `region` — the derived Bay Area sub-region,
 *   - `serverTime` + `ageSeconds`/`isStale` — so a model can say how fresh the fix
 *     is instead of implying a stale position is live.
 */
import { classifyBayAreaRegion } from "@backend/lib/bay-area-region";
import { compassFromBearing } from "@backend/services/drive-geo-match";
import { GoogleMapsService } from "@backend/services/google/maps";
import { getLocation, tessieConfigured } from "@backend/services/tesla";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, READ_ONLY } from "../../types";

/** A Tessie fix older than this is flagged `isStale` so the model won't treat it as live. */
const STALE_AFTER_SECONDS = 120;

export const getVehicleLocation = defineTool({
  name: "get_vehicle_location",
  category: "tesla",
  title: "Where the car is right now",
  description:
    "Live GPS position of the configured vehicle, read fresh from Tessie, ENRICHED by the worker for an in-car " +
    "assistant: heading (degrees + compass point), a resolved street address (reverse-geocoded when Tessie omits " +
    "one), the Bay Area sub-region, and freshness (`serverTime`, `ageSeconds`, `isStale`). Use this to answer " +
    "'where am I' / 'which way am I heading' when the driver is in the car. For the last-known PHONE/browser " +
    "position (or a combined best-of-both), use get_user_location instead.",
  inputShape: {},
  annotations: READ_ONLY,
  outputShape: {
    latitude: z.number(),
    longitude: z.number(),
    heading: z.number().nullable(),
    headingCompass: z.string().nullable(),
    address: z.string().nullable(),
    region: z.string().nullable(),
    mapUrl: z.string(),
    /** ISO timestamp the worker answered — the anchor for `ageSeconds`. */
    serverTime: z.string(),
    /** Seconds between Tessie's fix time and now, when Tessie reported a fix time. */
    ageSeconds: z.number().nullable(),
    /** True when the fix is older than the staleness threshold (or its age is unknown). */
    isStale: z.boolean(),
    note: z.string(),
  },
  examples: [{ title: "Where is the car?", args: {} }],
  handler: async ({ env }) => {
    if (!(await tessieConfigured(env))) {
      toolError(
        "Tesla is not configured (TESSIE_API_TOKEN / TESLA_BETSY_VIN). See /admin/config/integrations/tesla.",
      );
    }
    const loc = await getLocation(env);
    if (!loc) {
      toolError("Tessie returned no position — the car may be asleep or unreachable.");
    }

    // Fill a street address when Tessie didn't include one. Quota-gated on the
    // Geocoding SKU; returns null on quota block or error, so it never bills past
    // the free tier and never fails the whole call.
    let address = loc.address ?? null;
    if (!address) {
      const parsed = await new GoogleMapsService(env)
        .reverseGeocode(loc.latitude, loc.longitude)
        .catch(() => null);
      address = parsed?.formattedAddress ?? null;
    }

    const region =
      classifyBayAreaRegion({ latitude: loc.latitude, longitude: loc.longitude })?.name ?? null;

    const nowMs = Date.now();
    const ageSeconds =
      loc.timestampMs != null ? Math.max(0, Math.round((nowMs - loc.timestampMs) / 1000)) : null;
    // Unknown age is treated as stale — better to under-promise freshness than to
    // narrate a possibly-old fix as live.
    const isStale = ageSeconds == null || ageSeconds > STALE_AFTER_SECONDS;

    const note = isStale
      ? ageSeconds == null
        ? "Tessie did not report a fix time; treat this position as last-known rather than guaranteed-live."
        : `This fix is ~${ageSeconds}s old — the car may have moved since.`
      : "Live fix from Tessie.";

    return {
      latitude: loc.latitude,
      longitude: loc.longitude,
      heading: loc.heading ?? null,
      headingCompass: compassFromBearing(loc.heading),
      address,
      region,
      mapUrl: `https://www.google.com/maps/search/?api=1&query=${loc.latitude},${loc.longitude}`,
      serverTime: new Date(nowMs).toISOString(),
      ageSeconds,
      isStale,
      note,
    };
  },
});
