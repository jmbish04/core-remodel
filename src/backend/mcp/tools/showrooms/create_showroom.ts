import type { GooglePlaceDetails } from "@frontend/components/showroom/intake/places-mapper";

import { showroomStoreLinks, showroomStores } from "@backend/db";
import { GoogleMapsService } from "@backend/services/google/maps";
import {
  resolveStoreGeoPatch,
  mapPlaceDetailsToStoreInput,
} from "@backend/services/showroom/onboarding";
import { findDuplicateStore } from "@backend/services/showroom/duplicate-check";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { defineTool, WRITE } from "../../types";
import { showroomUrl } from "../../urls";
import { persistPlaceShowroom, rethrowMapsError } from "./_shared";

export const createShowroom = defineTool({
  name: "create_showroom",
  category: "showrooms",
  title: "Create showroom",
  description:
    "Intake a new showroom store location. STRONGLY PREFER passing a Google `placeId` (from search_showrooms): " +
    "with a placeId this kicks the exact same FULL onboarding as import_showroom_from_place — Places Details + AI " +
    "review analysis, coordinates + region-hub capture, photos, brands, favicon + website scrape, and AI research " +
    "— and any explicit fields you also pass (e.g. pricePoint) override the Google-derived values. Without a " +
    "placeId it creates a manual row from the fields you provide; only `name` is required. The region hub (East " +
    "Bay / South Bay / …) is captured immediately, but ONBOARDING RUNS IN THE BACKGROUND: this tool returns " +
    'right away with `status:"processing"` and the bare store row — do NOT wait on it and do NOT retry on a ' +
    "timeout (the work is durable). Poll `check_showroom_intake_status` (by showroomId or placeId) to watch " +
    "enrichment finish (photos, brands, hours, access level). Idempotent on `placeId` (an existing placeId " +
    "returns the existing store unchanged, `created:false`).",
  inputShape: {
    name: z
      .string()
      .optional()
      .describe("Store / location name (required unless a placeId is given)"),
    placeId: z
      .string()
      .optional()
      .describe(
        "Google Place ID (from search_showrooms) — triggers full AI onboarding when provided",
      ),
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
    {
      title: "From a Google Place (full onboarding)",
      args: { placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" },
    },
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
    status: z.string(),
    store: looseObject({ id: z.number().int(), name: z.string().nullable() }),
    region: z.string().nullable(),
    url: urlField,
  },
  handler: async ({ env, db }, input) => {
    // ── Duplicate guard (all paths) ───────────────────────────────────────
    // Reject if an ACTIVE store already matches by place_id / phone / website /
    // address, using whatever the caller provided. Returns the existing row
    // rather than creating a second copy. The placeId path re-checks the
    // Google-derived fields below (an existing store may have a different
    // placeId but the same phone/address).
    const dupByInput = await findDuplicateStore(db, {
      placeId: input.placeId,
      phoneNumber: input.phoneNumber,
      websiteUrl: input.websiteUrl,
      locationAddress: input.locationAddress,
    });
    if (dupByInput) {
      const [existing] = await db
        .select()
        .from(showroomStores)
        .where(eq(showroomStores.id, dupByInput.id))
        .limit(1);
      if (existing) {
        return {
          created: false,
          status: `exists (matched by ${dupByInput.reason})`,
          store: existing,
          region: existing.hubName ?? null,
          url: showroomUrl(env, existing.id),
        };
      }
    }

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
          status: "exists",
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
      if (input.websiteUrl) mapped.websiteUrl = input.websiteUrl;
      if (input.isAppointmentOnly != null) {
        mapped.values.isAppointmentOnly = input.isAppointmentOnly;
      }

      // Re-check against the Google-derived fields: a store with a DIFFERENT
      // placeId but the same phone/website/address is still the same showroom.
      const dupByPlace = await findDuplicateStore(db, {
        placeId: mapped.values.placeId,
        phoneNumber: mapped.values.phoneNumber,
        websiteUrl: mapped.websiteUrl,
        locationAddress: mapped.values.locationAddress,
      });
      if (dupByPlace) {
        const [existing] = await db
          .select()
          .from(showroomStores)
          .where(eq(showroomStores.id, dupByPlace.id))
          .limit(1);
        if (existing) {
          return {
            created: false,
            status: `exists (matched by ${dupByPlace.reason})`,
            store: existing,
            region: existing.hubName ?? null,
            url: showroomUrl(env, existing.id),
          };
        }
      }

      const created = await persistPlaceShowroom(env, db, mapped);
      return {
        created: true,
        status: "processing",
        store: created,
        region: created.hubName ?? null,
        url: showroomUrl(env, created.id),
      };
    }

    // ── Manual path: name + provided fields, region + enrichment captured ──
    const name = input.name?.trim();
    if (!name) toolError("`name` is required and cannot be empty (or pass a placeId).");

    const geo = await resolveStoreGeoPatch(db, {
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
        zipCode: input.zipCode,
        pricePoint: input.pricePoint,
        isAppointmentOnly: input.isAppointmentOnly,
        scrapeStatus: "pending",
        ...geo,
      })
      .returning();

    // Website → showroom_store_links (WEBSITE), not a store column.
    const manualWebsite = input.websiteUrl?.trim();
    if (manualWebsite) {
      await db.insert(showroomStoreLinks).values({
        storeId: created.id,
        url: manualWebsite,
        type: "WEBSITE",
      });
    }

    // Kick background enrichment durably (research always; favicon + scrape when a
    // website is known) and return immediately — MCP has no waitUntil, so the
    // ShowroomOnboardingWorkflow keeps the work alive. Poll check_showroom_intake_status.
    await env.SHOWROOM_ONBOARDING_WORKFLOW.create({
      params: {
        showroomId: created.id,
        enrichment: { websiteUrl: manualWebsite ?? null },
      },
    });

    return {
      created: true,
      status: "processing",
      store: created,
      region: created.hubName ?? null,
      url: showroomUrl(env, created.id),
    };
  },
});
