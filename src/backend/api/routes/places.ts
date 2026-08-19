/**
 * @fileoverview Places API proxy router — `/api/places`
 *
 * Proxies the Google Places (New) API so the frontend never holds the API key.
 * All outbound requests are gated behind the monthly free-tier quota enforced
 * by `GoogleMapsService.isUnderMonthlyQuota()`. Every call is appended to the
 * `google_maps_usage_log` table for cost attribution and dashboard rendering.
 *
 * Endpoints:
 *   GET /api/places/autocomplete        Typeahead suggestions from Places Autocomplete
 *   GET /api/places/details/:placeId    Rich place record from Places Details
 *
 * Auth: all routes sit under `/api/places/*` which is gated by `requireAccessAuth`
 * middleware registered in `src/backend/api/index.ts`.
 *
 * Error codes:
 *   429  MAPS_QUOTA_EXCEEDED — monthly free-tier limit reached
 *   502  Upstream Google Places API failure
 *   400  Invalid request parameters (zod-openapi validation)
 *   500  Unexpected server error
 */

import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";

import { GoogleMapsService } from "@/backend/services/google/maps";
import { getGoogleMapsApiKey } from "@/backend/utils/secrets";

export const placesRouter = new OpenAPIHono<{ Bindings: Env }>();

/**
 * GET /maps-js-key — hand the browser the Maps JavaScript API key.
 *
 * Street View is the ONE Maps feature that must run client-side (only the
 * browser `StreetViewService`/`StreetViewPanorama` can detect + render a
 * panorama). Rather than bake a key into the client bundle at build time, the
 * key is served here at runtime from the `GOOGLE_MAPS_API` secrets-store
 * binding — behind the same `requireAccessAuth` gate as the rest of `/api/places`,
 * so only authenticated sessions receive it.
 *
 * NOTE (key restriction): this is the SAME key used server-side for Places. A
 * Google key allows only ONE application-restriction type, so for the browser
 * SDK to work this key must be HTTP-referrer-restricted (or unrestricted) AND
 * have the Maps JavaScript API enabled. An IP-restricted server key will be
 * rejected by the browser SDK. Use a dedicated referrer-restricted key value if
 * you don't want to relax the server key.
 */
placesRouter.get("/maps-js-key", async (c) => {
  // Never let a browser or intermediate proxy cache the credential.
  c.header("Cache-Control", "no-store");
  let key: string;
  try {
    key = await getGoogleMapsApiKey(c.env);
  } catch (err) {
    // A thrown error is an operational failure (binding read, etc.), not a
    // clean "unset" — log it and surface a distinct 500 so it's debuggable.
    console.error("maps-js-key: failed to read GOOGLE_MAPS_API:", err);
    return c.json({ error: "Failed to read Maps key" }, 500);
  }
  if (!key) return c.json({ error: "Maps key not configured" }, 503);
  return c.json({ key });
});

// ─── Shared error schemas ────────────────────────────────────────────────────

const ErrorSchema = z.object({
  error: z.string().openapi({ description: "Human-readable error message." }),
});

// ─── GET /autocomplete ───────────────────────────────────────────────────────

/**
 * Zod schema for a single autocomplete suggestion returned from the proxy.
 * `placeId` is used in a subsequent `placeDetails` call to fetch full data.
 */
const AutocompleteSuggestionSchema = z.object({
  placeId: z
    .string()
    .min(1)
    .openapi({ description: "Opaque Google Place ID (e.g. 'ChIJ...')." }),
  text: z
    .string()
    .min(1)
    .openapi({ description: "Human-readable prediction label shown in the typeahead list." }),
});

const AutocompleteResponseSchema = z.object({
  suggestions: z
    .array(AutocompleteSuggestionSchema)
    .openapi({ description: "Ordered list of place predictions; may be empty." }),
});

placesRouter.openapi(
  createRoute({
    method: "get",
    path: "/autocomplete",
    operationId: "placesAutocomplete",
    tags: ["Places"],
    summary: "Autocomplete a partial place name or address",
    description:
      "Proxies the Google Places (New) Autocomplete API. Supply a `sessionToken` and reuse " +
      "it in the subsequent `placeDetails` call so Google charges the entire sequence as a " +
      "single billing session rather than per-keystroke.",
    request: {
      query: z.object({
        q: z
          .string()
          .min(1)
          .openapi({ description: "Partial place name or address to autocomplete.", example: "Hardware Flooring SF" }),
        sessionToken: z
          .string()
          .optional()
          .openapi({
            description:
              "Optional UUID grouping autocomplete keystrokes with a terminal placeDetails call " +
              "into a single Google billing session.",
            example: "550e8400-e29b-41d4-a716-446655440000",
          }),
      }),
    },
    responses: {
      200: {
        description: "Autocomplete suggestions (may be an empty array when no predictions match).",
        content: {
          "application/json": { schema: AutocompleteResponseSchema },
        },
      },
      429: {
        description: "Monthly Google Maps free-tier quota exceeded.",
        content: { "application/json": { schema: ErrorSchema } },
      },
      502: {
        description: "Upstream Google Places API returned an error.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { q, sessionToken } = c.req.valid("query");
    const service = new GoogleMapsService(c.env);

    try {
      const result = await service.placesAutocomplete(q, sessionToken);
      return c.json(result, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "MAPS_QUOTA_EXCEEDED") {
        return c.json({ error: "Monthly Google Maps free-tier quota exceeded." }, 429);
      }
      console.error("[places/autocomplete] upstream error:", message);
      return c.json({ error: `Upstream Places API error: ${message}` }, 502);
    }
  },
);

// ─── GET /details/:placeId ───────────────────────────────────────────────────

/**
 * Permissive schema for the Google Places Details response.
 *
 * Most fields are optional/nullable because Google omits fields the place hasn't
 * populated (e.g. `rating` for unclaimed listings). `.passthrough()` preserves
 * any future Google additions without breaking the OpenAPI contract.
 */
const LocalizedTextSchema = z
  .object({
    text: z.string().optional().nullable(),
    languageCode: z.string().optional().nullable(),
  })
  .passthrough();

const LatLngSchema = z
  .object({
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
  })
  .passthrough();

const OpeningHoursSchema = z
  .object({
    weekdayDescriptions: z.array(z.string()).optional().nullable(),
  })
  .passthrough();

/**
 * Schema for the Google Places (New) `reviewSummary` field.
 *
 * The API returns an AI-generated synopsis of the place sourced from
 * user reviews. Shape: `{ text: { text: string, languageCode: string }, ... }`.
 * `.passthrough()` preserves any future additions to the wrapper object.
 */
const ReviewSummarySchema = z
  .object({
    text: z
      .object({
        text: z.string().optional().nullable(),
        languageCode: z.string().optional().nullable(),
      })
      .optional()
      .nullable(),
  })
  .passthrough();

const PlaceDetailsResponseSchema = z
  .object({
    id: z.string().optional().nullable().openapi({ description: "Google Place ID." }),
    displayName: LocalizedTextSchema.optional().nullable(),
    formattedAddress: z.string().optional().nullable(),
    location: LatLngSchema.optional().nullable(),
    nationalPhoneNumber: z.string().optional().nullable(),
    internationalPhoneNumber: z.string().optional().nullable(),
    websiteUri: z.string().optional().nullable(),
    regularOpeningHours: OpeningHoursSchema.optional().nullable(),
    /** Secondary opening-hours periods (e.g. kitchen hours, drive-through hours). */
    regularSecondaryOpeningHours: z
      .array(OpeningHoursSchema)
      .optional()
      .nullable()
      .openapi({
        description:
          "Secondary opening hours, e.g. drive-through or kitchen hours. " +
          "Each element follows the same shape as regularOpeningHours.",
      }),
    currentOpeningHours: OpeningHoursSchema.optional().nullable(),
    priceLevel: z.string().optional().nullable(),
    priceRange: z.record(z.string(), z.unknown()).optional().nullable(),
    rating: z.number().optional().nullable(),
    userRatingCount: z.number().int().optional().nullable(),
    reviews: z
      .array(
        z
          .object({
            rating: z.number().optional().nullable(),
            text: z
              .object({
                text: z.string().optional().nullable(),
              })
              .passthrough()
              .optional()
              .nullable(),
            relativePublishTimeDescription: z.string().optional().nullable(),
          })
          .passthrough(),
      )
      .optional()
      .nullable()
      .openapi({ description: "Up to 5 most-relevant user reviews from Google Places." }),
    editorialSummary: LocalizedTextSchema.optional().nullable(),
    generativeSummary: z.record(z.string(), z.unknown()).optional().nullable(),
    /**
     * AI-generated summary of the place derived from user reviews.
     * Populated when Google has sufficient review data. Passthrough preserves
     * future envelope keys Google may add around the text object.
     */
    reviewSummary: ReviewSummarySchema.optional().nullable().openapi({
      description:
        "Google-generated AI synopsis of the place based on user reviews. " +
        "Present only when Google has sufficient review data for the location.",
    }),
    types: z.array(z.string()).optional().nullable(),
    primaryType: z.string().optional().nullable(),
    photos: z
      .array(
        z
          .object({
            name: z.string(),
            widthPx: z.number().int().optional().nullable(),
            heightPx: z.number().int().optional().nullable(),
            authorAttributions: z
              .array(
                z
                  .object({
                    displayName: z.string().optional().nullable(),
                    uri: z.string().optional().nullable(),
                    photoUri: z.string().optional().nullable(),
                  })
                  .passthrough(),
              )
              .optional()
              .nullable(),
            flagContentUri: z.string().optional().nullable(),
            googleMapsUri: z.string().optional().nullable(),
          })
          .passthrough(),
      )
      .optional()
      .nullable()
      .openapi({
        description:
          "Photo references for this place. Use the `name` field (e.g. " +
          "'places/ChIJ.../photos/A...' ) to construct a photo-media URL. " +
          "Pass the full photo objects to the showroom-store create endpoint " +
          "so the frontend can render thumbnails without re-fetching.",
      }),
    businessStatus: z.string().optional().nullable(),
    /**
     * Rich Gemini-powered structured inference derived from the review sample.
     * Present only when the AI call succeeded and reviews were available.
     * Includes homeowner-framed attributes, brand extraction, and review
     * authenticity assessment (with Google Search grounding when available).
     */
    aiInference: z
      .object({
        // 2-3 sentence homeowner-facing summary (mirrors reviewSummary text).
        summary: z.string().optional().nullable(),

        // Price tier inferred from review language.
        // "PRICE_LEVEL_UNSPECIFIED" = consciously no signal found (clean exit).
        // null = field couldn't be produced.
        inferredPricePoint: z
          .enum(["$", "$$", "$$$", "$$$$", "PRICE_LEVEL_UNSPECIFIED"])
          .nullable()
          .optional()
          .openapi({
            description:
              "Price tier inferred from explicit pricing language in the reviews. " +
              '"PRICE_LEVEL_UNSPECIFIED" when the model consciously finds no pricing signal ' +
              "(clean, trustworthy exit — not an error). " +
              "null only when the field genuinely couldn't be produced. " +
              "Use as a fallback when Google's `priceLevel` field is absent.",
          }),

        priceReasoning: z
          .string()
          .nullable()
          .optional()
          .openapi({
            description:
              "Quoted phrase(s) from the reviews that drove the inferred price tier. " +
              "null when no pricing inference was made.",
          }),

        // Per-attribute flags with rationale, each sourced from review language.
        attributes: z
          .object({
            appointmentOnly: z
              .object({ value: z.boolean(), rationale: z.string() })
              .passthrough()
              .optional()
              .nullable(),
            flagshipLocation: z
              .object({ value: z.boolean(), rationale: z.string() })
              .passthrough()
              .optional()
              .nullable(),
            largeSelection: z
              .object({ value: z.boolean(), rationale: z.string() })
              .passthrough()
              .optional()
              .nullable(),
            bespokeCurated: z
              .object({ value: z.boolean(), rationale: z.string() })
              .passthrough()
              .optional()
              .nullable()
              .openapi({
                description:
                  "True when reviews rave about unique/mold-breaking selection. " +
                  "False when reviews call the selection overpriced, stale, or generic.",
              }),
            tradeRepRequired: z
              .object({ value: z.boolean(), rationale: z.string() })
              .passthrough()
              .optional()
              .nullable()
              .openapi({
                description:
                  "True when reviews indicate homeowners are turned away or must bring a " +
                  "trade pro to visit or buy. Trade-only pricing games are a RED FLAG. " +
                  "If non-trade visitors were welcomed despite signage, value=false with nuance in rationale.",
              }),
          })
          .passthrough()
          .optional()
          .nullable()
          .openapi({ description: "Per-attribute boolean flags derived from review language." }),

        // Review authenticity cross-check via Google Search grounding.
        reviewAuthenticity: z
          .object({
            assessment: z
              .enum([
                "AUTHENTIC",
                "MOSTLY_AUTHENTIC",
                "MIXED",
                "SUSPICIOUS",
                "UNVERIFIED",
              ])
              .optional()
              .nullable()
              .openapi({
                description:
                  '"UNVERIFIED" when Google Search grounding was unavailable. ' +
                  '"SUSPICIOUS" when cross-checking found evidence of bought/bot reviews.',
              }),
            rationale: z.string().optional().nullable(),
            sources: z
              .array(z.string())
              .optional()
              .nullable()
              .openapi({
                description:
                  "URLs consulted during the authenticity cross-check (e.g. Reddit threads). " +
                  "Empty array when grounding was unavailable.",
              }),
          })
          .passthrough()
          .optional()
          .nullable()
          .openapi({
            description:
              "Gemini review-authenticity assessment using Google Search grounding. " +
              'assessment="UNVERIFIED" when grounding was not available.',
          }),

        // Brands carried or affiliated with the showroom.
        brands: z
          .array(
            z
              .object({
                name: z.string(),
                type: z
                  .string()
                  .openapi({
                    description:
                      'Category label e.g. "Plumbing", "Tile", "Slabs", "Appliances".',
                  }),
                websiteUrl: z.string().optional().nullable(),
              })
              .passthrough(),
          )
          .optional()
          .nullable()
          .openapi({
            description:
              "Brands the showroom carries or affiliates with, extracted from reviews " +
              "and Gemini's knowledge.",
          }),

        // Internal metadata — not for display; useful for debugging.
        _meta: z
          .object({
            engine: z
              .enum(["interactions", "gateway"])
              .optional()
              .openapi({
                description:
                  '"interactions" when the direct Gemini Interactions API (Google Search grounded) ' +
                  'produced this result; "gateway" when it fell back to the AI-Gateway generateContent path.',
              }),
            model: z.string().optional(),
            groundingUsed: z.boolean().optional(),
          })
          .passthrough()
          .optional()
          .nullable(),
      })
      .passthrough()
      .optional()
      .nullable()
      .openapi({
        description:
          "Rich Gemini-powered structured inference based on the review sample. " +
          "Includes homeowner-framed attributes, brand list, and review-authenticity " +
          "assessment (Google Search grounded when available). " +
          "Absent when reviews were unavailable or the AI call failed.",
      }),
  })
  .passthrough()
  .openapi({ description: "Rich Google Places (New) Details payload." });

placesRouter.openapi(
  createRoute({
    method: "get",
    path: "/details/{placeId}",
    operationId: "placesDetails",
    tags: ["Places"],
    summary: "Fetch full details for a Google Place",
    description:
      "Proxies the Google Places (New) Details API. If you supply the same `sessionToken` " +
      "used during the preceding autocomplete calls, Google closes the billing session and " +
      "charges the full sequence as a single Details call.",
    request: {
      params: z.object({
        placeId: z
          .string()
          .min(1)
          .openapi({ description: "Google Place ID to look up.", example: "ChIJN1t_tDeuEmsRUsoyG83frY4" }),
      }),
      query: z.object({
        sessionToken: z
          .string()
          .optional()
          .openapi({
            description:
              "Optional session token that was passed to `placesAutocomplete` to close the billing session.",
            example: "550e8400-e29b-41d4-a716-446655440000",
          }),
        skipAi: z
          .enum(["0", "1", "true", "false"])
          .optional()
          .openapi({
            description:
              "When '1'/'true', skip the Gemini review analysis and return only the raw Google fields " +
              "(fast). The intake UI uses this to prefill immediately, then calls POST /details/ai-insight " +
              "for the Gemini pass — a two-phase progress UX with no extra Places Details billing.",
            example: "1",
          }),
      }),
    },
    responses: {
      200: {
        description: "Rich Google Places Details payload.",
        content: {
          "application/json": { schema: PlaceDetailsResponseSchema },
        },
      },
      429: {
        description: "Monthly Google Maps free-tier quota exceeded.",
        content: { "application/json": { schema: ErrorSchema } },
      },
      502: {
        description: "Upstream Google Places API returned an error.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const { placeId } = c.req.valid("param");
    const { sessionToken, skipAi } = c.req.valid("query");
    const service = new GoogleMapsService(c.env);

    try {
      const data = await service.placeDetails(placeId, sessionToken, {
        skipAi: skipAi === "1" || skipAi === "true",
      });
      return c.json(data, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "MAPS_QUOTA_EXCEEDED") {
        return c.json({ error: "Monthly Google Maps free-tier quota exceeded." }, 429);
      }
      console.error("[places/details] upstream error:", message);
      return c.json({ error: `Upstream Places API error: ${message}` }, 502);
    }
  },
);

// ─── POST /details/ai-insight ────────────────────────────────────────────────
// Second phase of the two-phase intake: the client posts back the Places
// payload it already fetched (via GET /details/{id}?skipAi=1) and we run ONLY
// the Gemini review analysis on it. Reusing the already-fetched payload means
// no additional Places Details billing — just the (logged) Gemini call.
placesRouter.openapi(
  createRoute({
    method: "post",
    path: "/details/ai-insight",
    operationId: "placesDetailsAiInsight",
    tags: ["Places"],
    summary: "Run Gemini review analysis for an already-fetched place",
    description:
      "Runs the Gemini structured review analysis on a Places Details payload the client already " +
      "holds (from GET /details/{placeId}?skipAi=1). No Places API call is made here, so there is " +
      "no additional Places billing — only the (logged) Gemini request. Powers the intake modal's " +
      "prefill-then-analyze progress UX.",
    request: {
      body: {
        content: {
          "application/json": {
            // The raw Places Details payload from phase 1 (passthrough — we only
            // read id/displayName/formattedAddress/reviews/priceLevel/etc.).
            schema: z.object({}).passthrough().openapi({
              description: "The Places Details payload returned by GET /details/{placeId}?skipAi=1.",
            }),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Gemini inference (and the Gemini-authored review summary, if any).",
        content: {
          "application/json": {
            schema: z
              .object({
                aiInference: z.any().nullable(),
                reviewSummary: z.string().nullable(),
              })
              .openapi({ description: "Gemini structured inference + summary text." }),
          },
        },
      },
      502: {
        description: "Gemini analysis failed.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  }),
  async (c) => {
    const data = c.req.valid("json") as Record<string, unknown>;
    const service = new GoogleMapsService(c.env);
    try {
      // Mutates `data` in place, adding aiInference + replacing reviewSummary.
      await service.computeReviewInsight(data);
      const reviewSummary =
        (data.reviewSummary as { text?: { text?: string } } | undefined)?.text?.text ?? null;
      return c.json(
        { aiInference: data.aiInference ?? null, reviewSummary },
        200,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[places/details/ai-insight] error:", message);
      return c.json({ error: `Gemini analysis error: ${message}` }, 502);
    }
  },
);
