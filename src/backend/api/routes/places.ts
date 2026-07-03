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

export const placesRouter = new OpenAPIHono<{ Bindings: Env }>();

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
    reviews: z.array(z.record(z.string(), z.unknown())).optional().nullable(),
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
    photos: z.array(z.record(z.string(), z.unknown())).optional().nullable(),
    businessStatus: z.string().optional().nullable(),
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
    const { sessionToken } = c.req.valid("query");
    const service = new GoogleMapsService(c.env);

    try {
      const data = await service.placeDetails(placeId, sessionToken);
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
