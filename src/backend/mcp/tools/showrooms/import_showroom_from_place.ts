import { showroomStores } from "@backend/db";
import { GoogleMapsService } from "@backend/services/google/maps";
import { mapPlaceDetailsToStoreInput } from "@backend/services/showroom/onboarding";
import { findDuplicateStore } from "@backend/services/showroom/duplicate-check";
import type { GooglePlaceDetails } from "@frontend/components/showroom/intake/places-mapper";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { showroomUrl } from "../../urls";
import { defineTool, WRITE_IDEMPOTENT } from "../../types";

import { adoptPlaceLocation, persistPlaceShowroom, rethrowMapsError } from "./_shared";

export const importShowroomFromPlace = defineTool({
  name: "import_showroom_from_place",
  category: "showrooms",
  title: "Import a showroom from a Google Place",
  description:
    "One-step FULL onboarding of a showroom from a Google `placeId` (typically one returned by search_showrooms) — " +
    "the same flow the front-end intake form runs. Fetches Places Details WITH the Gemini review analysis to " +
    "populate name, description, address, coordinates, phone, website, structured hours, Google rating/review " +
    "count, an AI review summary, the inferred price tier, and the appointment/flagship/large-selection/bespoke/" +
    "trade-rep flags, and captures the Bay Area region hub — then KICKS the rest of enrichment in the background: " +
    "Google photos → Cloudflare Images (+ hero), detected-brand create/map, favicon + full website scrape, AI " +
    "renovation-fit research, and category inference. Returns IMMEDIATELY with `status:\"processing\"` and the " +
    "freshly-created row (do NOT wait on it, and do NOT retry on a timeout — the work is durable); poll " +
    "`check_showroom_intake_status` by showroomId or placeId to see enrichment finish. Idempotent by `placeId`: an " +
    "existing store is returned unchanged (`created:false`, `status:\"exists\"`); otherwise a new row is inserted " +
    "(`created:true`). Prefer this over create_showroom whenever you have a placeId. Quota-metered (Places + " +
    "Gemini) — surfaces MAPS_QUOTA_EXCEEDED clearly.",
  inputShape: {
    placeId: z
      .string()
      .min(1)
      .describe("Google Place ID from search_showrooms (e.g. 'ChIJ...')"),
  },
  annotations: WRITE_IDEMPOTENT,
  outputShape: {
    created: z.boolean(),
    status: z.string(),
    showroomId: z.number().int(),
    url: urlField,
    region: z.string().nullable(),
    store: looseObject({ id: z.number().int(), name: z.string().nullable() }),
  },
  examples: [{ title: "Import a candidate", args: { placeId: "ChIJN1t_tDeuEmsRUsoyG83frY4" } }],
  handler: async ({ env, db }, input) => {
    const placeId = input.placeId?.trim();
    if (!placeId) toolError("`placeId` is required and cannot be empty.");

    // Idempotency: a store with this placeId already exists → return it.
    const [existing] = await db
      .select()
      .from(showroomStores)
      .where(eq(showroomStores.placeId, placeId))
      .limit(1);
    if (existing) {
      return {
        created: false,
        status: "exists",
        showroomId: existing.id,
        url: showroomUrl(env, existing.id),
        region: existing.hubName ?? null,
        store: existing,
      };
    }

    // Fetch Google fields + the Gemini review analysis (aiInference) inline so
    // MCP onboarding matches the intake form. Non-fatal if Gemini is skipped.
    let details: Record<string, unknown>;
    try {
      details = await new GoogleMapsService(env).placeDetails(placeId);
    } catch (err) {
      rethrowMapsError(err);
    }

    const mapped = mapPlaceDetailsToStoreInput(details as GooglePlaceDetails);
    if (!mapped) {
      toolError(`Google returned no usable place for placeId "${placeId}".`);
    }
    // Ensure the placeId is stored even if the payload omitted `id`.
    mapped.values.placeId = mapped.values.placeId ?? placeId;

    // Fuzzy match: an existing ACTIVE store with the same phone/website/address.
    // Only a match that ALREADY has a placeId is a true duplicate (it is already
    // located) — return it unchanged. A match WITHOUT a placeId is a bare stub
    // (e.g. an AI-research entry created by name before it had a location): adopt
    // this Google location onto it and let onboarding enrich, rather than
    // rejecting the import. Casting a wide research net then bulk-importing is the
    // primary flow, so filling stubs in place — not flagging them — is the point.
    const dup = await findDuplicateStore(db, {
      placeId: mapped.values.placeId,
      phoneNumber: mapped.values.phoneNumber,
      websiteUrl: mapped.websiteUrl,
      locationAddress: mapped.values.locationAddress,
    });
    if (dup?.placeId) {
      const [existingDup] = await db
        .select()
        .from(showroomStores)
        .where(eq(showroomStores.id, dup.id))
        .limit(1);
      if (existingDup) {
        return {
          created: false,
          status: `exists (matched by ${dup.reason})`,
          showroomId: existingDup.id,
          url: showroomUrl(env, existingDup.id),
          region: existingDup.hubName ?? null,
          store: existingDup,
        };
      }
    }
    if (dup) {
      // Bare stub matched by phone/address/website but with no placeId — fill it.
      const adopted = await adoptPlaceLocation(env, db, dup.id, mapped);
      return {
        created: false,
        status: `located (adopted onto existing store, matched by ${dup.reason})`,
        showroomId: adopted.id,
        url: showroomUrl(env, adopted.id),
        region: adopted.hubName ?? null,
        store: adopted,
      };
    }

    const created = await persistPlaceShowroom(env, db, mapped);

    return {
      created: true,
      status: "processing",
      showroomId: created.id,
      url: showroomUrl(env, created.id),
      region: created.hubName ?? null,
      store: created,
    };
  },
});
