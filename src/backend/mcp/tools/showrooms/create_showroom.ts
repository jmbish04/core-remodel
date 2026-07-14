import { showroomStores } from "@backend/db";
import { GoogleMapsService } from "@backend/services/google/maps";
import {
  computeStoreGeoPatch,
  mapPlaceDetailsToStoreInput,
  scheduleShowroomEnrichment,
} from "@backend/services/showroom/onboarding";
import type { GooglePlaceDetails } from "@frontend/components/showroom/intake/places-mapper";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, WRITE } from "../../types";
import { persistPlaceShowroom, rethrowMapsError } from "./_shared";

export const createShowroom = defineTool({
  name: "create_showroom",
  category: "showrooms",
  title: "Create showroom",
  description:
    "Intake a new showroom store location. STRONGLY PREFER passing a Google `placeId` (from search_showrooms): " +
    "with a placeId this runs the exact same FULL onboarding as import_showroom_from_place — Places Details + AI " +
    "review analysis, coordinates + region-hub capture, photos, brands, favicon + website scrape, and AI research " +
    "— and any explicit fields you also pass (e.g. pricePoint) override the Google-derived values. Without a " +
    "placeId it creates a manual row from the fields you provide; only `name` is required. Either way the region " +
    "hub (East Bay / South Bay / …) is captured from the coordinates/address/ZIP so the store shows under the " +
    "correct directory filter, and AI research + a website scrape (when a websiteUrl is present) run in the " +
    "background. Idempotent on `placeId` (an existing placeId returns the existing store unchanged).",
  inputShape: {
    name: z.string().optional().describe("Store / location name (required unless a placeId is given)"),
    placeId: z
      .string()
      .optional()
      .describe("Google Place ID (from search_showrooms) — triggers full AI onboarding when provided"),
    description: z.string().optional(),
    locationAddress: z.string().optional().describe("Street address of the location"),
    latitude: z.number().optional().describe("Latitude — enables the individual map marker"),
    longitude: z.number().optional().describe("Longitude — enables the individual map marker"),
    phoneNumber: z.string().optional(),
    emailAddress: z.string().optional(),
    websiteUrl: z.string().optional(),
    zipCode: z.string().optional(),
    pricePoint: z.enum(["$", "$$", "$$$", "$$$$"]).optional(),
    isAppointmentOnly: z.boolean().optional().describe("True if the store is appointment-only"),
  },
  annotations: WRITE,
  examples: [
    { title: "From a Google Place (full onboarding)", args: { placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" } },
    { title: "Minimal manual", args: { name: "Studio Belmont" } },
    {
      title: "Manual with details",
      args: {
        name: "DaVinci Marble",
        locationAddress: "150 Executive Park Blvd, San Francisco",
        websiteUrl: "https://davincimarble.com",
        pricePoint: "$$$",
      },
    },
  ],
  outputShape: {
    created: z.boolean(),
    store: looseObject({ id: z.number().int(), name: z.string().nullable() }),
    region: z.string().nullable(),
    url: urlField,
  },
  handler: async ({ env, db }, input) => {
    // ── placeId path: full onboarding, idempotent by placeId ──────────────
    const placeId = input.placeId?.trim();
    if (placeId) {
      const [existing] = await db
        .select()
        .from(showroomStores)
        .where(eq(showroomStores.placeId, placeId))
        .limit(1);
      if (existing) {
        return {
          created: false,
          store: existing,
          region: existing.hubName ?? null,
          url: showroomUrl(env, existing.id),
        };
      }

      let details: Record<string, unknown>;
      try {
        details = await new GoogleMapsService(env).placeDetails(placeId);
      } catch (err) {
        rethrowMapsError(err);
      }
      const mapped = mapPlaceDetailsToStoreInput(details as GooglePlaceDetails);
      if (!mapped) toolError(`Google returned no usable place for placeId "${placeId}".`);
      mapped.values.placeId = mapped.values.placeId ?? placeId;

      // Explicit caller fields override the Google-derived values.
      if (input.name?.trim()) mapped.values.name = input.name.trim();
      if (input.description) mapped.values.description = input.description;
      if (input.pricePoint) mapped.values.pricePoint = input.pricePoint;
      if (input.phoneNumber) mapped.values.phoneNumber = input.phoneNumber;
      if (input.emailAddress) mapped.values.emailAddress = input.emailAddress;
      if (input.websiteUrl) mapped.values.websiteUrl = input.websiteUrl;
      if (input.isAppointmentOnly != null) {
        mapped.values.isAppointmentOnly = input.isAppointmentOnly;
      }

      const created = await persistPlaceShowroom(env, db, mapped);
      return {
        created: true,
        store: created,
        region: created.hubName ?? null,
        url: showroomUrl(env, created.id),
      };
    }

    // ── Manual path: name + provided fields, region + enrichment captured ──
    const name = input.name?.trim();
    if (!name) toolError("`name` is required and cannot be empty (or pass a placeId).");

    const geo = computeStoreGeoPatch({
      latitude: input.latitude,
      longitude: input.longitude,
      zipCode: input.zipCode,
      locationAddress: input.locationAddress,
    });

    const [created] = await db
      .insert(showroomStores)
      .values({
        name,
        description: input.description,
        locationAddress: input.locationAddress,
        phoneNumber: input.phoneNumber,
        emailAddress: input.emailAddress,
        websiteUrl: input.websiteUrl,
        zipCode: input.zipCode,
        pricePoint: input.pricePoint,
        isAppointmentOnly: input.isAppointmentOnly,
        ...geo,
      })
      .returning();

    // Fire + await background enrichment (research always; favicon + scrape
    // when a website is known). No waitUntil in MCP, so await it.
    const tasks: Promise<unknown>[] = [];
    scheduleShowroomEnrichment(
      env,
      created,
      { websiteUrl: input.websiteUrl },
      (p) => tasks.push(p),
    );
    await Promise.allSettled(tasks);

    return {
      created: true,
      store: created,
      region: created.hubName ?? null,
      url: showroomUrl(env, created.id),
    };
  },
});
