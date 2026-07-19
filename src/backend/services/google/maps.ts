import { GoogleGenAI } from "@google/genai";
import { and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";

import { googleMapsUsage } from "@backend/db/schema";
import { createGeminiAiGatewayClient } from "@backend/services/render/providers/gemini-stage-provider";
import { getGoogleMapsApiKey } from "@/backend/utils/secrets";

/**
 * Monthly free-tier request quota for the Google Maps Platform Essentials tier.
 * Usage beyond this limit incurs charges; GoogleMapsService gates each call
 * behind `isUnderMonthlyQuota()` to prevent runaway spend.
 */
export const MAPS_MONTHLY_FREE_TIER_LIMIT = 10_000;

/**
 * Optional metadata written alongside the base logUsage fields.
 * All properties are nullable so existing 2-arg callers need no changes.
 */
interface LogUsageMeta {
  /** Normalized endpoint label (e.g. 'autocomplete', 'details'). */
  endpoint?: string;
  /** Google Places session token linking autocomplete keystrokes to their terminal details call. */
  sessionToken?: string;
  /** HTTP status code returned by the upstream Google Maps API response. */
  statusCode?: number;
}

/** Granular address parts parsed from a Google Places response. */
export interface ParsedAddress {
  formattedAddress: string | null;
  streetNumber: string | null;
  streetName: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  googleMapsUri: string | null;
}

/**
 * Parse a Google Places (v1) place payload into granular address parts.
 * Reads `addressComponents` (type-tagged), preferring `locality` for city and
 * falling back to `postal_town` / `sublocality`. State uses the 2-letter
 * `shortText`. Returns all-null parts when no components are present.
 */
export function parseGoogleAddressComponents(
  data: Record<string, unknown>,
): ParsedAddress {
  const comps = (data.addressComponents as
    | Array<{ longText?: string; shortText?: string; types?: string[] }>
    | undefined) ?? [];
  const pick = (type: string, short = false): string | null => {
    const c = comps.find((x) => x.types?.includes(type));
    if (!c) return null;
    return (short ? c.shortText : c.longText) ?? c.longText ?? c.shortText ?? null;
  };
  return {
    formattedAddress: (data.formattedAddress as string | undefined) ?? null,
    streetNumber: pick("street_number"),
    streetName: pick("route"),
    city: pick("locality") ?? pick("postal_town") ?? pick("sublocality"),
    state: pick("administrative_area_level_1", true),
    zipCode: pick("postal_code"),
    googleMapsUri: (data.googleMapsUri as string | undefined) ?? null,
  };
}

export class GoogleMapsService {
  constructor(private readonly env: Env) {}

  // ─── Quota helpers ────────────────────────────────────────────────────────

  async canUseGoogleMaps(): Promise<boolean> {
    const db = drizzle(this.env.DB);
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const currentMonthEnd = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    ).getTime();

    // Google Maps Free Tier: $200/mo.
    // Places Text Search ($17/1000) + Routes ($5/1000) = $22 per 1000 dual-requests.
    // Total maximum dual-requests before exceeding $200 is ~9000. Capped at 8000 for safety.
    const MAX_CALLS_PER_MONTH = 8000;

    try {
      const usageQuery = await db
        .select({ total: sql<number>`count(${googleMapsUsage.id})` })
        .from(googleMapsUsage)
        .where(
          and(
            sql`${googleMapsUsage.timestamp} >= ${currentMonthStart}`,
            sql`${googleMapsUsage.timestamp} <= ${currentMonthEnd}`,
          ),
        )
        .get();

      return (usageQuery?.total ?? 0) <= MAX_CALLS_PER_MONTH;
    } catch (e) {
      console.error("Failed to check Google Maps usage:", e);
      // Fail-open strategy if D1 schema isn't migrated yet
      return true;
    }
  }

  /**
   * Returns total request count, per-endpoint breakdown, and the calendar
   * month string ('YYYY-MM') for the current month.
   *
   * Because `timestamp` is stored as Unix SECONDS in SQLite's integer column,
   * the filter uses `strftime` with `'unixepoch'` so SQLite interprets the
   * value correctly rather than treating it as milliseconds.
   *
   * Fails open — returns zeros if the table hasn't been migrated yet so the
   * admin dashboard always renders without a crash.
   */
  async getMonthlyUsage(): Promise<{
    total: number;
    byEndpoint: Record<string, number>;
    month: string;
  }> {
    const db = drizzle(this.env.DB);

    // 'YYYY-MM' string for the current UTC month.
    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    // Start-of-month as a Unix SECONDS boundary (the `timestamp` column is
    // Drizzle `mode:"timestamp"` → seconds). Computing this in JS and doing a
    // plain numeric `timestamp >= …` keeps the query SARGABLE, so SQLite can use
    // an index on `timestamp` instead of a full table scan on every quota check.
    // (Replaces the earlier non-sargable `strftime(datetime(...))` predicate.)
    const startOfMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const startOfMonthSeconds = Math.floor(startOfMonth / 1000);

    try {
      /**
       * Group rows by coalesced endpoint label.
       * When `endpoint` is NULL (legacy callers), fall back to `api_type`
       * so every row contributes to exactly one bucket.
       */
      const rows = await db
        .select({
          bucket: sql<string>`coalesce(${googleMapsUsage.endpoint}, ${googleMapsUsage.apiType})`,
          count: sql<number>`count(${googleMapsUsage.id})`,
        })
        .from(googleMapsUsage)
        .where(sql`${googleMapsUsage.timestamp} >= ${startOfMonthSeconds}`)
        .groupBy(
          sql`coalesce(${googleMapsUsage.endpoint}, ${googleMapsUsage.apiType})`,
        )
        .all();

      const byEndpoint: Record<string, number> = {};
      let total = 0;

      for (const row of rows) {
        byEndpoint[row.bucket] = Number(row.count);
        total += Number(row.count);
      }

      return { total, byEndpoint, month };
    } catch (e) {
      console.error("Failed to fetch monthly Maps usage:", e);
      // Fail-open: return zero counts so dashboards render even on schema lag.
      return { total: 0, byEndpoint: {}, month };
    }
  }

  /**
   * Returns true when this month's request count is below the Essentials
   * free-tier cap (`MAPS_MONTHLY_FREE_TIER_LIMIT`).
   */
  async isUnderMonthlyQuota(): Promise<boolean> {
    const { total } = await this.getMonthlyUsage();
    return total < MAPS_MONTHLY_FREE_TIER_LIMIT;
  }

  // ─── Logging ─────────────────────────────────────────────────────────────

  /**
   * Append an immutable usage row to `google_maps_usage_log`.
   *
   * The optional `meta` argument accepts the 2026-07 extension columns
   * (`endpoint`, `sessionToken`, `statusCode`). Existing 2/3-arg callers
   * (e.g. `computeCommute`) pass no meta and remain fully backward-compatible.
   *
   * @param apiType    High-level API category label (e.g. 'places:searchText').
   * @param request    Request payload sent to the upstream API.
   * @param response   Response payload received from the upstream API.
   * @param meta       Optional metadata for the new nullable columns.
   */
  async logUsage(
    apiType: string,
    request: unknown,
    response: unknown,
    meta?: LogUsageMeta,
  ): Promise<void> {
    const db = drizzle(this.env.DB);
    try {
      await db.insert(googleMapsUsage).values({
        apiType,
        apiRequest: JSON.stringify(request),
        apiResponse: JSON.stringify(response),
        timestamp: new Date(),
        ...(meta?.endpoint !== undefined ? { endpoint: meta.endpoint } : {}),
        ...(meta?.sessionToken !== undefined ? { sessionToken: meta.sessionToken } : {}),
        ...(meta?.statusCode !== undefined ? { statusCode: meta.statusCode } : {}),
      });
    } catch (e) {
      console.error(`Failed to log Google Maps usage for ${apiType}:`, e);
    }
  }

  // ─── Places API (New) — Autocomplete ─────────────────────────────────────

  /**
   * Proxy the Google Places (New) Autocomplete endpoint.
   *
   * Returns a simplified suggestion list so the client never receives the raw
   * Google response (which contains the API key path in error payloads).
   * The full request body is logged; only the suggestion count is stored in the
   * response column to keep the log row small.
   *
   * Session tokens group an autocomplete sequence with its terminal Details
   * call so the entire interaction is billed as a single session at the
   * Details price rather than per-character.
   *
   * @param input         The user's partial text input.
   * @param sessionToken  Optional Places session token; pass the same value to
   *                      the subsequent `placeDetails` call to close the session.
   * @throws Error('MAPS_QUOTA_EXCEEDED') when the monthly free-tier limit is reached.
   * @throws Error('PLACES_AUTOCOMPLETE_ERROR: <message>') on upstream failure.
   */
  async placesAutocomplete(
    input: string,
    sessionToken?: string,
  ): Promise<{ suggestions: Array<{ placeId: string; text: string }> }> {
    if (!(await this.isUnderMonthlyQuota())) {
      throw new Error("MAPS_QUOTA_EXCEEDED");
    }

    const gmapKey = await getGoogleMapsApiKey(this.env);

    const requestBody: Record<string, unknown> = { input };
    if (sessionToken) {
      requestBody.sessionToken = sessionToken;
    }

    const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": gmapKey,
        "X-Goog-FieldMask":
          "suggestions.placePrediction.placeId,suggestions.placePrediction.text",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(5000),
    });

    const data = (await res.json()) as {
      suggestions?: Array<{
        placePrediction?: {
          placeId?: string;
          text?: { text?: string };
        };
      }>;
      error?: { message?: string };
    };

    // Log usage — store only suggestion count in the response field to keep
    // the log row compact; the full request is always persisted.
    const suggestions: Array<{ placeId: string; text: string }> = (
      data.suggestions ?? []
    )
      .filter((s) => s.placePrediction?.placeId && s.placePrediction?.text?.text)
      .map((s) => ({
        placeId: s.placePrediction!.placeId!,
        text: s.placePrediction!.text!.text!,
      }));

    await this.logUsage(
      "places:autocomplete",
      requestBody,
      { suggestionCount: suggestions.length, statusCode: res.status },
      { endpoint: "autocomplete", sessionToken, statusCode: res.status },
    );

    if (!res.ok) {
      const errMsg = data.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`PLACES_AUTOCOMPLETE_ERROR: ${errMsg}`);
    }

    return { suggestions };
  }

  // ─── Places API (New) — Details ───────────────────────────────────────────

  /**
   * Proxy the Google Places (New) Details endpoint.
   *
   * Returns the full rich Places payload (hours, rating, reviews, photos, etc.)
   * and stores the complete response in the usage log because the details record
   * is the primary audit artifact.
   *
   * When `sessionToken` is provided the URL includes it so Google closes the
   * autocomplete billing session (the entire sequence is charged as one Details
   * call rather than per-character).
   *
   * @param placeId       Google Place ID (e.g. 'ChIJ...').
   * @param sessionToken  Optional token that was used for the preceding
   *                      `placesAutocomplete` calls.
   * @throws Error('MAPS_QUOTA_EXCEEDED') when the monthly free-tier limit is reached.
   * @throws Error('PLACES_DETAILS_ERROR: <message>') on upstream failure.
   */
  async placeDetails(
    placeId: string,
    sessionToken?: string,
    opts?: { skipAi?: boolean },
  ): Promise<Record<string, unknown>> {
    if (!(await this.isUnderMonthlyQuota())) {
      throw new Error("MAPS_QUOTA_EXCEEDED");
    }

    const gmapKey = await getGoogleMapsApiKey(this.env);

    const fieldMask = [
      "id",
      "displayName",
      "formattedAddress",
      "location",
      "nationalPhoneNumber",
      "internationalPhoneNumber",
      "websiteUri",
      "regularOpeningHours",
      "regularSecondaryOpeningHours",
      "currentOpeningHours",
      "priceLevel",
      "priceRange",
      "rating",
      "userRatingCount",
      "reviews",
      "editorialSummary",
      "generativeSummary",
      "reviewSummary",
      "types",
      "primaryType",
      "photos",
      "businessStatus",
    ].join(",");

    let url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
    if (sessionToken) {
      url += `?sessionToken=${encodeURIComponent(sessionToken)}`;
    }

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-Goog-Api-Key": gmapKey,
        "X-Goog-FieldMask": fieldMask,
      },
      signal: AbortSignal.timeout(5000),
    });

    const data = (await res.json()) as Record<string, unknown>;

    // Log full response — the details payload is the valuable audit record.
    await this.logUsage(
      "places:details",
      { placeId, sessionToken },
      data,
      { endpoint: "details", sessionToken, statusCode: res.status },
    );

    if (!res.ok) {
      const errData = data as { error?: { message?: string } };
      const errMsg = errData.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`PLACES_DETAILS_ERROR: ${errMsg}`);
    }

    // Two-phase intake UX: when `skipAi` is set the caller wants the raw Google
    // fields immediately and will run the (slow) Gemini analysis in a second
    // request via `computeReviewInsight` — so the modal can prefill first, then
    // show AI progress. When not skipping, run it inline as before.
    if (!opts?.skipAi) {
      await this.computeReviewInsight(data);
    }

    return data;
  }

  /**
   * Gemini review analysis + structured inference. Mutates `data` in place,
   * setting `data.aiInference` and replacing `data.reviewSummary` with the
   * Gemini summary when the place has an identity. Extracted from
   * `placeDetails` so the intake UI can prefill Google fields first (via
   * `placeDetails(..., { skipAi: true })`) and call this second for a two-phase
   * progress UX. The caller passes the already-fetched place payload, so this
   * triggers NO additional Places Details billing.
   */
  async computeReviewInsight(data: Record<string, unknown>): Promise<void> {
    // ── Gemini review analysis + structured inference (via AI Gateway) ──────
    // Replaces Google's `reviewSummary` with a richer homeowner-framed Gemini
    // analysis using Google-Search grounding.
    //
    // IMPORTANT: Google's Places `reviews` field requires a pricier SKU that
    // isn't enabled in production, so `data.reviews` is frequently absent or
    // empty. This block MUST NOT be gated on reviews being present — it runs
    // for every place that has an identity (id or displayName), and instructs
    // Gemini to use Google Search grounding to find and read reviews/discussion
    // itself (Google Maps reviews, Yelp, Reddit, design forums) using the
    // business name + address + Maps URL + Place ID. Any Google-supplied
    // review sample (when present) is included as additional signal, not a
    // requirement.
    //
    // Strategy:
    //   1. PRIMARY PATH — enable grounding via config.tools=[{googleSearch:{}}].
    //      Do NOT set responseSchema/responseMimeType (Gemini can't combine them
    //      with grounding). Instruct the model in the prompt to emit exactly one
    //      JSON object. Parse defensively (strip ```json fences, slice first {
    //      to last }).
    //   2. FALLBACK PATH — if the grounded call fails, retry with no tools +
    //      responseMimeType:"application/json" + responseSchema. In this path,
    //      reviewAuthenticity.assessment is forced to "UNVERIFIED".
    //
    // On any failure: block skipped; Google's original reviewSummary is left
    // intact and no aiInference key is written.
    const reviews = data.reviews as
      | Array<{
          rating?: number;
          text?: { text?: string };
          originalText?: { text?: string };
          relativePublishTimeDescription?: string;
        }>
      | undefined;

    const resolvedPlaceId = data.id as string | undefined;
    const displayName = (data.displayName as { text?: string } | undefined)?.text;
    const hasIdentity = Boolean(resolvedPlaceId || displayName);

    if (hasIdentity) {
      try {
        const rating = data.rating as number | undefined;
        const userRatingCount = data.userRatingCount as number | undefined;
        const formattedAddress = data.formattedAddress as string | undefined;
        const googlePriceLevel = data.priceLevel as string | undefined;
        const googleMapsUri =
          (data.googleMapsUri as string | undefined) ??
          (resolvedPlaceId
            ? `https://www.google.com/maps/place/?q=place_id:${resolvedPlaceId}`
            : undefined);

        // Google's review array may be empty/unavailable (pricier SKU not
        // enabled) — build the sample from whatever IS present, but do not
        // require it. Gemini is instructed to search for reviews itself.
        const sample = Array.isArray(reviews) ? reviews.slice(0, 5) : [];
        const n = sample.length;

        const reviewLines =
          n > 0
            ? sample
                .map((r, i) => {
                  const stars = r.rating != null ? `${r.rating}/5` : "no rating";
                  const body = r.text?.text ?? r.originalText?.text ?? "(no text)";
                  const when = r.relativePublishTimeDescription ?? "";
                  return `Review ${i + 1} (${stars}${when ? `, ${when}` : ""}): ${body}`;
                })
                .join("\n")
            : "(none provided by Google for this call — use Google Search to find reviews yourself.)";

        const placeContext = [
          displayName ? `Business: ${displayName}` : null,
          formattedAddress ? `Address: ${formattedAddress}` : null,
          googleMapsUri ? `Google Maps URL: ${googleMapsUri}` : null,
          resolvedPlaceId ? `Place ID: ${resolvedPlaceId}` : null,
          rating != null
            ? `Overall rating: ${rating}/5 (${userRatingCount ?? "unknown"} total reviews)`
            : null,
          `Google's structured priceLevel for this place is: ${googlePriceLevel ?? "none"}; ` +
            `treat it as ONE input signal but form your OWN informed judgment for inferredPricePoint ` +
            `— do not simply pass it through.`,
        ]
          .filter(Boolean)
          .join("\n");

        // ── JSON schema description embedded in prompt (for grounded path) ────
        // Must describe every field because responseSchema is NOT set when
        // grounding tools are active.
        const JSON_SCHEMA_DESCRIPTION = `
Output ONLY a single JSON object with this exact shape (no prose before or after):
{
  "summary": "<string: 2-3 fair, homeowner-facing sentences on overall sentiment and standout points — strengths AND caveats; no marketing fluff>",
  "inferredPricePoint": "<one of: '$' | '$$' | '$$$' | '$$$$' | 'PRICE_LEVEL_UNSPECIFIED' | null>",
  "priceReasoning": "<string or null: quote the review phrase(s) that drove the tier; null when no inference made>",
  "attributes": {
    "appointmentOnly":  { "value": <boolean>, "rationale": "<string: cite review language>" },
    "flagshipLocation": { "value": <boolean>, "rationale": "<string: cite review language or knowledge>" },
    "largeSelection":   { "value": <boolean>, "rationale": "<string: cite review language>" },
    "bespokeCurated":   { "value": <boolean>, "rationale": "<string: cite review language; false if generic/overpriced/stale>" },
    "tradeRepRequired": { "value": <boolean>, "rationale": "<string: quote review; if non-trade visitors welcomed despite signage, value=false and note that nuance>" }
  },
  "reviewAuthenticity": {
    "assessment": "<one of: 'AUTHENTIC' | 'MOSTLY_AUTHENTIC' | 'MIXED' | 'SUSPICIOUS' | 'UNVERIFIED'>",
    "rationale": "<string: explain your assessment>",
    "sources": ["<URL used to cross-check>", "..."]
  },
  "brands": [
    { "name": "<brand name>", "type": "<category e.g. Plumbing|Tile|Slabs|Appliances>", "websiteUrl": "<URL or empty string>" }
  ],
  "socialLinks": [
    { "type": "<one of: 'INSTAGRAM' | 'FACEBOOK' | 'PINTEREST' | 'YOUTUBE' | 'TIKTOK' | 'LINKEDIN' | 'HOUZZ' | 'YELP'>", "url": "<canonical profile URL>" }
  ]
}

Rules for each field:
- inferredPricePoint: ALWAYS return a value for this field — never omit it. Form your OWN informed judgment; Google's structured priceLevel (given above) is only ONE input signal, not something to simply pass through. Map explicit pricing language → budget/cheap/affordable="$", moderate/reasonable/mid-range="$$", mid-to-high/premium/upper-mid="$$$", luxury/very-expensive/high-end-only="$$$$". Mixed signals → central tier. Use "PRICE_LEVEL_UNSPECIFIED" when you consciously find NO pricing signal anywhere (reviews, search results, or general knowledge) — this is a clean, deliberate exit, NOT an error or a guess. Use null ONLY when the field genuinely cannot be produced.
- priceReasoning: ALWAYS return a value for this field explaining your OWN reasoning (which may reference Google's priceLevel as one data point among others); required when inferredPricePoint is one of the $ tiers, and still expected (e.g. explaining why you chose PRICE_LEVEL_UNSPECIFIED) otherwise.
- attributes.tradeRepRequired: true when reviews indicate homeowners are turned away or must bring a trade pro to visit or buy. "Trade-only" pricing games (hidden prices, contractor discounts) are a RED FLAG for homeowners. But if reviews say non-trade visitors were welcomed despite trade-only signage, set value=false and capture that nuance in the rationale.
- attributes.bespokeCurated: true when reviews genuinely rave about unique/mold-breaking selection even without marketing language; false when reviews call the selection overpriced, stale, or generic.
- reviewAuthenticity: USE your Google Search grounding to cross-check whether the Google reviews look genuine vs bought/bot. Look for corroborating discussion on Reddit (r/ subreddit threads like "best tile SF", "best plumber Bay Area") and other sources. Put any URLs you consulted in the sources array.
- brands: extract every brand the showroom carries or affiliates with from reviews + your knowledge. Include websiteUrl as a real URL when known, or empty string.
- socialLinks: USE your Google Search grounding to find THIS business's OFFICIAL social profiles. Return [] when you find none — that is a valid answer. HARD RULES: (1) never guess or construct a URL from the business name — only report a profile you actually found; (2) the profile must demonstrably belong to THIS business at THIS address (check the bio/contact/location against the address and website domain above) — beware same-name businesses in other cities/states; (3) NEVER return share/intent endpoints (facebook.com/sharer, pinterest.com/pin/create, x.com/intent) — those are share widgets, not profiles; (4) return the canonical profile URL with no tracking params and no deep links to individual posts/reels; (5) for a branch of a multi-location chain, the brand-level account is acceptable.`;

        // ── System prompt ─────────────────────────────────────────────────────
        const systemPrompt =
          `You are a trusted advisor writing for a HOMEOWNER (not a designer or trade professional) ` +
          `who is deciding whether to visit and potentially buy from this Bay Area remodel showroom. ` +
          `Be FAIR and BALANCED — acknowledge genuine strengths but surface any caveats ` +
          `(trade-only hostility, appointment requirements, pricing opacity, fake reviews). ` +
          `Homeowner-hostile showrooms that require a trade rep or hide pricing are RED FLAGS — flag them clearly. ` +
          `Showrooms that welcome non-trade visitors despite trade-only signage are a GOOD sign — note that. ` +
          `Google's review array may be EMPTY or UNAVAILABLE for this call (it requires a pricier API tier that isn't ` +
          `always enabled) — when that happens, USE GOOGLE SEARCH to find and read reviews and discussion about THIS ` +
          `specific business yourself: Google Maps reviews, Yelp, Reddit threads (e.g. r/ subreddits like "best tile SF" ` +
          `or "best plumber Bay Area"), and design forums — using the business name, address, Google Maps URL, and ` +
          `Place ID provided below to identify the correct business. Base your analysis on what you find. Never refuse ` +
          `or leave a field blank merely because Google's review sample was empty.`;

        // ── User prompt ───────────────────────────────────────────────────────
        const userPrompt =
          `PLACE CONTEXT (use these identifiers to find the correct business via Google Search):\n${placeContext}\n\n` +
          `GOOGLE-SUPPLIED REVIEW SAMPLE (${n} of ${userRatingCount ?? "unknown"} total reviews on record` +
          `${rating != null ? `, overall ${rating}/5 stars` : ""}):\n` +
          `${reviewLines}\n\n` +
          (n > 0
            ? `Note: this is a sample of ${n} of ${userRatingCount ?? "unknown"} reviews. ` +
              `Consider whether the sample seems representative of the ${rating ?? "unknown"}-star average. ` +
              `Use Google Search to find ADDITIONAL reviews/discussion beyond this sample as well.\n\n`
            : `Note: Google did not supply any review text for this call. This is EXPECTED — it does NOT mean the ` +
              `business has no reviews. USE GOOGLE SEARCH NOW to find and read real reviews and discussion about ` +
              `this specific business (Google Maps, Yelp, Reddit, design forums) and base your entire analysis on ` +
              `what you find there.\n\n`) +
          `${JSON_SCHEMA_DESCRIPTION}`;

        // ── Gemini responseSchema for fallback (no-grounding) path ────────────
        const FALLBACK_RESPONSE_SCHEMA = {
          type: "OBJECT",
          properties: {
            summary: { type: "STRING" },
            inferredPricePoint: {
              type: "STRING",
              nullable: true,
              enum: ["$", "$$", "$$$", "$$$$", "PRICE_LEVEL_UNSPECIFIED"],
            },
            priceReasoning: { type: "STRING", nullable: true },
            attributes: {
              type: "OBJECT",
              properties: {
                appointmentOnly: {
                  type: "OBJECT",
                  properties: {
                    value: { type: "BOOLEAN" },
                    rationale: { type: "STRING" },
                  },
                  required: ["value", "rationale"],
                },
                flagshipLocation: {
                  type: "OBJECT",
                  properties: {
                    value: { type: "BOOLEAN" },
                    rationale: { type: "STRING" },
                  },
                  required: ["value", "rationale"],
                },
                largeSelection: {
                  type: "OBJECT",
                  properties: {
                    value: { type: "BOOLEAN" },
                    rationale: { type: "STRING" },
                  },
                  required: ["value", "rationale"],
                },
                bespokeCurated: {
                  type: "OBJECT",
                  properties: {
                    value: { type: "BOOLEAN" },
                    rationale: { type: "STRING" },
                  },
                  required: ["value", "rationale"],
                },
                tradeRepRequired: {
                  type: "OBJECT",
                  properties: {
                    value: { type: "BOOLEAN" },
                    rationale: { type: "STRING" },
                  },
                  required: ["value", "rationale"],
                },
              },
              required: [
                "appointmentOnly",
                "flagshipLocation",
                "largeSelection",
                "bespokeCurated",
                "tradeRepRequired",
              ],
            },
            reviewAuthenticity: {
              type: "OBJECT",
              properties: {
                assessment: {
                  type: "STRING",
                  enum: [
                    "AUTHENTIC",
                    "MOSTLY_AUTHENTIC",
                    "MIXED",
                    "SUSPICIOUS",
                    "UNVERIFIED",
                  ],
                },
                rationale: { type: "STRING" },
                sources: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["assessment", "rationale", "sources"],
            },
            brands: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING" },
                  type: { type: "STRING" },
                  websiteUrl: { type: "STRING" },
                },
                required: ["name", "type", "websiteUrl"],
              },
            },
            socialLinks: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  type: {
                    type: "STRING",
                    enum: [
                      "INSTAGRAM",
                      "FACEBOOK",
                      "PINTEREST",
                      "YOUTUBE",
                      "TIKTOK",
                      "LINKEDIN",
                      "HOUZZ",
                      "YELP",
                    ],
                  },
                  url: { type: "STRING" },
                },
                required: ["type", "url"],
              },
            },
          },
          required: [
            "summary",
            "inferredPricePoint",
            "priceReasoning",
            "attributes",
            "reviewAuthenticity",
            "brands",
            "socialLinks",
          ],
        };

        // ── Type for the parsed rich AI inference ─────────────────────────────
        type AttributeFlag = { value: boolean; rationale: string };
        type RichReviewInsight = {
          summary?: string;
          inferredPricePoint?: "$" | "$$" | "$$$" | "$$$$" | "PRICE_LEVEL_UNSPECIFIED" | null;
          priceReasoning?: string | null;
          attributes?: {
            appointmentOnly?: AttributeFlag;
            flagshipLocation?: AttributeFlag;
            largeSelection?: AttributeFlag;
            bespokeCurated?: AttributeFlag;
            tradeRepRequired?: AttributeFlag;
          };
          reviewAuthenticity?: {
            assessment?:
              | "AUTHENTIC"
              | "MOSTLY_AUTHENTIC"
              | "MIXED"
              | "SUSPICIOUS"
              | "UNVERIFIED";
            rationale?: string;
            sources?: string[];
          };
          brands?: Array<{ name: string; type: string; websiteUrl: string }>;
          socialLinks?: Array<{ type: string; url: string }>;
        };

        // ── Helper: extract raw JSON text from a Gemini response ──────────────
        // Handles three response shapes: the Interactions API (`output_text` /
        // `text`), and the classic generateContent candidate-parts shape.
        function extractRawJson(geminiResp: unknown): string {
          const raw = (
            (geminiResp as any)?.output_text ??
            (geminiResp as any)?.candidates?.[0]?.content?.parts?.[0]?.text ??
            (geminiResp as any)?.text ??
            ""
          );
          return typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
        }

        // ── Helper: parse JSON defensively (strips ```json fences) ───────────
        function parseInsightJson(raw: string): RichReviewInsight | null {
          // Strip possible ```json ... ``` fences.
          let cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
          // Find the outermost JSON object.
          const first = cleaned.indexOf("{");
          const last = cleaned.lastIndexOf("}");
          if (first === -1 || last === -1 || last <= first) return null;
          cleaned = cleaned.slice(first, last + 1);
          try {
            return JSON.parse(cleaned) as RichReviewInsight;
          } catch {
            return null;
          }
        }

        // ── Helper: log every Gemini call for cost-audit protection ──────────
        // Never lets a logging failure break the response; never logs the full
        // prompt/output text (lengths + usage/token metadata + model only).
        const logGeminiCall = async (
          model: string,
          engine: "interactions" | "gateway",
          promptChars: number,
          outputText: string,
          usage: unknown,
        ): Promise<void> => {
          try {
            await this.logUsage(
              "gemini:review-insight",
              { model, engine, promptChars },
              { outputChars: (outputText || "").length, usage: usage ?? null },
              { endpoint: "gemini-interactions" },
            );
          } catch (logErr) {
            console.error("[placeDetails] Failed to log Gemini usage (non-fatal):", logErr);
          }
        };

        const INTERACTIONS_MODEL = "gemini-3.5-flash";
        const GATEWAY_MODEL = "gemini-2.5-flash";

        let parsed: RichReviewInsight | null = null;
        let usedGrounding = false;
        let engineUsed: "interactions" | "gateway" = "gateway";
        let modelUsed: string = GATEWAY_MODEL;

        // The Interactions API takes a single input string — fold system framing
        // + JSON-schema description + place context into one prompt.
        const interactionsInput = `${systemPrompt}\n\n${userPrompt}`;

        // ── PRIMARY: direct Gemini Interactions API (Google Search grounded) ──
        // AI Gateway does not yet support the Interactions API, so this call
        // bypasses the gateway helper entirely and hits Gemini directly.
        try {
          const apiKey = await this.env.GEMINI_API_KEY.get();
          if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

          const directClient = new GoogleGenAI({ apiKey });

          if (!(directClient as any).interactions) {
            throw new Error("client.interactions is undefined on this @google/genai version");
          }

          const interaction = await (directClient as any).interactions.create({
            model: INTERACTIONS_MODEL,
            input: interactionsInput,
            tools: [{ type: "google_search" }],
          });

          const rawJson = extractRawJson(interaction);

          await logGeminiCall(
            INTERACTIONS_MODEL,
            "interactions",
            interactionsInput.length,
            rawJson,
            (interaction as any)?.usage ?? (interaction as any)?.usageMetadata ?? null,
          );

          if (rawJson) {
            parsed = parseInsightJson(rawJson);
            if (parsed) {
              usedGrounding = true;
              engineUsed = "interactions";
              modelUsed = INTERACTIONS_MODEL;
              console.info("[placeDetails] Gemini Interactions API (grounded) path succeeded.");
            } else {
              console.warn(
                "[placeDetails] Gemini Interactions API response was not parseable JSON; falling back.",
              );
            }
          }
        } catch (interactionsErr) {
          console.warn(
            "[placeDetails] Gemini Interactions API unavailable/failed; falling back to AI-Gateway generateContent.",
            interactionsErr,
          );
        }

        // ── FALLBACK 1: AI-Gateway generateContent, grounded ──────────────────
        if (!parsed) {
          const ai = await createGeminiAiGatewayClient(this.env);

          try {
            const groundedResponse = await (ai.models.generateContent as Function)({
              model: GATEWAY_MODEL,
              contents: [{ role: "user", parts: [{ text: userPrompt }] }],
              config: {
                systemInstruction: systemPrompt,
                tools: [{ googleSearch: {} }],
                // NOTE: responseSchema and responseMimeType intentionally omitted —
                // Gemini cannot combine structured JSON mode with grounding tools.
              },
            });

            const rawJson = extractRawJson(groundedResponse);

            await logGeminiCall(
              GATEWAY_MODEL,
              "gateway",
              userPrompt.length,
              rawJson,
              (groundedResponse as any)?.usageMetadata ?? null,
            );

            if (rawJson) {
              parsed = parseInsightJson(rawJson);
              if (parsed) {
                usedGrounding = true;
                engineUsed = "gateway";
                modelUsed = GATEWAY_MODEL;
                console.info("[placeDetails] Gemini AI-Gateway grounded path succeeded.");
              } else {
                console.warn(
                  "[placeDetails] Gemini AI-Gateway grounded response was not parseable JSON; falling back.",
                );
              }
            }
          } catch (groundedErr) {
            console.warn(
              "[placeDetails] Gemini AI-Gateway grounded call failed; falling back to ungrounded JSON mode.",
              groundedErr,
            );
          }

          // ── FALLBACK 2: AI-Gateway generateContent, no-tools + strict JSON ──
          if (!parsed) {
            const fallbackUserPrompt =
              userPrompt +
              `\n\nIMPORTANT: Google Search is NOT available for this call, so you cannot look up reviews. ` +
              `Base summary/attributes/brands on the review sample above (if any) and your own general knowledge ` +
              `of this business if you have any; otherwise state plainly in the summary that no review data was ` +
              `available for this call. Set reviewAuthenticity.assessment = "UNVERIFIED" and ` +
              `reviewAuthenticity.sources = [] regardless of your confidence.`;

            const fallbackResponse = await (ai.models.generateContent as Function)({
              model: GATEWAY_MODEL,
              contents: [{ role: "user", parts: [{ text: fallbackUserPrompt }] }],
              config: {
                systemInstruction: systemPrompt,
                responseMimeType: "application/json",
                responseSchema: FALLBACK_RESPONSE_SCHEMA,
              },
            });

            const rawJson = extractRawJson(fallbackResponse);

            await logGeminiCall(
              GATEWAY_MODEL,
              "gateway",
              fallbackUserPrompt.length,
              rawJson,
              (fallbackResponse as any)?.usageMetadata ?? null,
            );

            if (rawJson) {
              parsed = parseInsightJson(rawJson) ?? (JSON.parse(rawJson) as RichReviewInsight);
              // Enforce UNVERIFIED when grounding wasn't used.
              if (parsed?.reviewAuthenticity) {
                parsed.reviewAuthenticity.assessment = "UNVERIFIED";
                parsed.reviewAuthenticity.sources = [];
              }
              engineUsed = "gateway";
              modelUsed = GATEWAY_MODEL;
              console.info("[placeDetails] Gemini AI-Gateway fallback (no-grounding) path succeeded.");
            }
          }
        }

        // ── Write results to data ─────────────────────────────────────────────
        if (parsed) {
          const aiSummary = parsed.summary ?? "";

          // The `_meta.engine` on aiInference already records that this is a
          // Gemini summary; the string must stay clean because it renders
          // verbatim as the store's "AI review summary".
          data.reviewSummary = {
            text: {
              text: aiSummary,
              languageCode: "en",
            },
          };

          data.aiInference = {
            summary: aiSummary,
            inferredPricePoint: parsed.inferredPricePoint ?? null,
            priceReasoning: parsed.priceReasoning ?? null,
            attributes: parsed.attributes ?? null,
            reviewAuthenticity: parsed.reviewAuthenticity ?? {
              assessment: "UNVERIFIED",
              rationale: "No authenticity data produced.",
              sources: [],
            },
            brands: parsed.brands ?? [],
            socialLinks: parsed.socialLinks ?? [],
            _meta: { engine: engineUsed, model: modelUsed, groundingUsed: usedGrounding },
          };
        }
      } catch (aiErr) {
        // Gemini failure is non-fatal — leave Google's original reviewSummary intact
        // and write no aiInference key. The details response always returns.
        console.error("[placeDetails] Gemini summary failed:", aiErr);
      }
    }
  }

  // ─── Commute (existing — untouched) ──────────────────────────────────────

  // ─── Places API (New) — Text Search (single best match) ───────────────────

  /**
   * Resolve a free-text query (e.g. `"Studio Belmont Plumbing, San Francisco"`)
   * to the single best-matching Google Place via the Places (New) Text Search
   * endpoint.
   *
   * Used by the bulk-backfill "resolve" step to attach a `place_id` to showrooms
   * that were entered manually (no Places link). Returns a compact card-shaped
   * record for the confirmation UI, or `null` when Google finds no match.
   *
   * This is a lighter cousin of {@link placeDetails}: it returns only the fields
   * needed to render a confirmation card and to fill blank store columns, and it
   * never runs the Gemini review analysis. Callers that need the full rich
   * payload (reviews, photos, opening hours) should follow up with
   * {@link placeDetails} using the returned `placeId`.
   *
   * @param query  Free-text place query. Combining name + address yields the
   *               most reliable single match.
   * @returns The top match, or `null` when Google returns no candidates.
   * @throws Error('MAPS_QUOTA_EXCEEDED') when the monthly free-tier limit is reached.
   * @throws Error('PLACES_TEXT_SEARCH_ERROR: <message>') on upstream failure.
   */
  async placesTextSearch(query: string): Promise<{
    placeId: string;
    displayName: string | null;
    formattedAddress: string | null;
    rating: number | null;
    userRatingCount: number | null;
    nationalPhoneNumber: string | null;
    websiteUri: string | null;
  } | null> {
    if (!(await this.isUnderMonthlyQuota())) {
      throw new Error("MAPS_QUOTA_EXCEEDED");
    }

    const gmapKey = await getGoogleMapsApiKey(this.env);
    const requestBody = { textQuery: query, maxResultCount: 1 };

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": gmapKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.rating," +
          "places.userRatingCount,places.nationalPhoneNumber,places.websiteUri",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(5000),
    });

    const data = (await res.json()) as {
      places?: Array<{
        id?: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        rating?: number;
        userRatingCount?: number;
        nationalPhoneNumber?: string;
        websiteUri?: string;
      }>;
      error?: { message?: string };
    };

    await this.logUsage(
      "places:searchText",
      requestBody,
      { resultCount: data.places?.length ?? 0, statusCode: res.status },
      { endpoint: "textSearch:backfill", statusCode: res.status },
    );

    if (!res.ok) {
      const errMsg = data.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`PLACES_TEXT_SEARCH_ERROR: ${errMsg}`);
    }

    const top = data.places?.[0];
    if (!top?.id) return null;

    return {
      placeId: top.id,
      displayName: top.displayName?.text ?? null,
      formattedAddress: top.formattedAddress ?? null,
      rating: typeof top.rating === "number" ? top.rating : null,
      userRatingCount:
        typeof top.userRatingCount === "number" ? top.userRatingCount : null,
      nationalPhoneNumber: top.nationalPhoneNumber ?? null,
      websiteUri: top.websiteUri ?? null,
    };
  }

  /**
   * Fetch only the address parts for a place — a minimal cousin of
   * {@link placeDetails} used by the address-split backfill. Requests
   * `addressComponents` + `googleMapsUri` + `formattedAddress` and NEVER runs
   * the Gemini review analysis. Returns granular parts parsed from Google's
   * `addressComponents`, or `null` when Google returns nothing.
   *
   * @throws Error('MAPS_QUOTA_EXCEEDED') when the monthly free-tier limit is reached.
   * @throws Error('PLACES_DETAILS_ERROR: <message>') on upstream failure.
   */
  async placeAddressComponents(placeId: string): Promise<ParsedAddress | null> {
    if (!(await this.isUnderMonthlyQuota())) {
      throw new Error("MAPS_QUOTA_EXCEEDED");
    }
    const gmapKey = await getGoogleMapsApiKey(this.env);
    const fieldMask = ["id", "formattedAddress", "addressComponents", "googleMapsUri"].join(",");
    const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;

    const res = await fetch(url, {
      method: "GET",
      headers: { "X-Goog-Api-Key": gmapKey, "X-Goog-FieldMask": fieldMask },
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as Record<string, unknown>;

    await this.logUsage(
      "places:details",
      { placeId, addressOnly: true },
      data,
      { endpoint: "details:address", statusCode: res.status },
    );

    if (!res.ok) {
      const err = data as { error?: { message?: string } };
      throw new Error(`PLACES_DETAILS_ERROR: ${err.error?.message ?? `HTTP ${res.status}`}`);
    }
    return parseGoogleAddressComponents(data);
  }

  // ─── Places API (New) — Text Search (many candidates, discovery) ──────────

  /**
   * Multi-result Places Text Search for showroom DISCOVERY.
   *
   * Where {@link placesTextSearch} is hardwired to `maxResultCount: 1` (built to
   * backfill a `place_id` onto a store the caller already knows), this returns a
   * ranked LIST of candidate places so an agent can surface options during a
   * chat ("stone slab showrooms near San Francisco") and let the user pick which
   * ones to persist. It is the read-side of the 0018 showroom-search flow.
   *
   * Cost/quota discipline is identical to every other Places call: gated behind
   * {@link isUnderMonthlyQuota} (throws `MAPS_QUOTA_EXCEEDED`) and logged to
   * `google_maps_usage_log` via {@link logUsage} for cost attribution. It never
   * runs the (slow, billable) Gemini review analysis — this is a cheap, wide net.
   *
   * `near` handling (deliberately simple for v1): a `"lat,lng"` string becomes a
   * 50 km `locationBias` circle; any other free-text value (e.g. "San Francisco,
   * CA") is folded into the text query so Places biases by text. Richer
   * geocoded/`locationRestriction` handling is a documented follow-up.
   *
   * @param query  Free-text search (e.g. "European kitchen cabinetry showroom").
   * @param opts   `maxResults` (default 10, hard cap 20), `near`, `includedType`.
   * @returns Array of compact candidate cards (empty when Google finds nothing).
   * @throws Error('MAPS_QUOTA_EXCEEDED') when the monthly free-tier limit is reached.
   * @throws Error('PLACES_TEXT_SEARCH_ERROR: <message>') on upstream failure.
   */
  async placesTextSearchMany(
    query: string,
    opts?: { maxResults?: number; near?: string; includedType?: string },
  ): Promise<
    Array<{
      placeId: string;
      displayName: string | null;
      formattedAddress: string | null;
      rating: number | null;
      userRatingCount: number | null;
      nationalPhoneNumber: string | null;
      websiteUri: string | null;
      primaryType: string | null;
      types: string[];
      location: { latitude: number; longitude: number } | null;
    }>
  > {
    if (!(await this.isUnderMonthlyQuota())) {
      throw new Error("MAPS_QUOTA_EXCEEDED");
    }

    const gmapKey = await getGoogleMapsApiKey(this.env);

    // Clamp result count to the free-tier-friendly window (1..20, default 10).
    const maxResultCount = Math.min(Math.max(opts?.maxResults ?? 10, 1), 20);

    // Fold `near` into the request: a "lat,lng" pair drives a locationBias
    // circle; any other text is appended to the query so Places biases by text.
    let textQuery = query.trim();
    let locationBias: Record<string, unknown> | undefined;
    const near = opts?.near?.trim();
    if (near) {
      const latLng = near.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
      if (latLng) {
        locationBias = {
          circle: {
            center: { latitude: Number(latLng[1]), longitude: Number(latLng[2]) },
            radius: 50_000,
          },
        };
      } else {
        textQuery = `${textQuery} near ${near}`;
      }
    }

    const requestBody: Record<string, unknown> = { textQuery, maxResultCount };
    if (locationBias) requestBody.locationBias = locationBias;
    if (opts?.includedType) requestBody.includedType = opts.includedType;

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": gmapKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.rating," +
          "places.userRatingCount,places.nationalPhoneNumber,places.websiteUri," +
          "places.location,places.primaryType,places.types",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(5000),
    });

    const data = (await res.json()) as {
      places?: Array<{
        id?: string;
        displayName?: { text?: string };
        formattedAddress?: string;
        rating?: number;
        userRatingCount?: number;
        nationalPhoneNumber?: string;
        websiteUri?: string;
        primaryType?: string;
        types?: string[];
        location?: { latitude?: number; longitude?: number };
      }>;
      error?: { message?: string };
    };

    await this.logUsage(
      "places:searchText",
      requestBody,
      { resultCount: data.places?.length ?? 0, statusCode: res.status },
      { endpoint: "textSearch:discovery", statusCode: res.status },
    );

    if (!res.ok) {
      const errMsg = data.error?.message ?? `HTTP ${res.status}`;
      throw new Error(`PLACES_TEXT_SEARCH_ERROR: ${errMsg}`);
    }

    return (data.places ?? [])
      .filter((p): p is typeof p & { id: string } => Boolean(p.id))
      .map((p) => ({
        placeId: p.id,
        displayName: p.displayName?.text ?? null,
        formattedAddress: p.formattedAddress ?? null,
        rating: typeof p.rating === "number" ? p.rating : null,
        userRatingCount:
          typeof p.userRatingCount === "number" ? p.userRatingCount : null,
        nationalPhoneNumber: p.nationalPhoneNumber ?? null,
        websiteUri: p.websiteUri ?? null,
        primaryType: p.primaryType ?? null,
        types: Array.isArray(p.types) ? p.types : [],
        location:
          p.location?.latitude != null && p.location?.longitude != null
            ? { latitude: p.location.latitude, longitude: p.location.longitude }
            : null,
      }));
  }

  async computeCommute(
    homeAddress: string,
    searchQuery: string,
    details?: Record<string, unknown>,
  ): Promise<{ commuteSummary: string; distanceMiles: number; durationMinutes: number }> {
    const hasQuota = await this.canUseGoogleMaps();
    const d = details ?? {};
    if (!hasQuota) {
      d.googleMapsStatus = "rate_limited";
      throw new Error("Google Maps is rate limited (monthly free tier exceeded).");
    }

    const gmapKey = await getGoogleMapsApiKey(this.env);

    // Step A: Places API (New) Text Search
    const placesReqBody = { textQuery: searchQuery };
    const placesRes = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": gmapKey,
        "X-Goog-FieldMask": "places.id,places.formattedAddress",
      },
      body: JSON.stringify(placesReqBody),
      signal: AbortSignal.timeout(5000),
    });

    const placesData = (await placesRes.json()) as any;
    await this.logUsage("places:searchText", placesReqBody, placesData);

    const placeId = placesData.places?.[0]?.id;
    const formattedAddress = placesData.places?.[0]?.formattedAddress;

    if (!placeId) {
      throw new Error(`Google Maps Places API: Could not find place for query "${searchQuery}"`);
    }

    // Step B: Routes API
    const routesReqBody = {
      origin: { address: homeAddress },
      destination: { placeId: placeId },
      travelMode: "DRIVE",
    };

    const routesRes = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": gmapKey,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
      },
      body: JSON.stringify(routesReqBody),
      signal: AbortSignal.timeout(5000),
    });

    const routesData = (await routesRes.json()) as any;
    await this.logUsage("routes:computeRoutes", routesReqBody, routesData);

    const route = routesData.routes?.[0];

    if (!route) {
      throw new Error("Google Maps Routes API: No route found.");
    }

    const durationSecs = parseInt(route.duration.replace("s", ""));
    const durationMins = Math.round(durationSecs / 60);
    const distanceMiles = route.distanceMeters * 0.000621371;

    d.googleMapsResponse = {
      success: true,
      distanceMiles,
      durationMinutes: durationMins,
      formattedAddress,
      placeId,
    };
    d.googleMapsStatus = "ok";

    return {
      commuteSummary: `Google Maps API Driving Data (to ${formattedAddress}): ${distanceMiles.toFixed(1)} miles, ${durationMins} minutes each way.`,
      distanceMiles,
      durationMinutes: durationMins,
    };
  }

  // ─── Routes API — traffic-aware matrix (multi-stop planning) ─────────────

  /**
   * Traffic-aware drive-time matrix between waypoints.
   *
   * `computeCommute` above answers "how far is this one place from home?".
   * Route planning needs every pairwise leg at once, at a specific departure
   * time, with traffic — a 22-minute hop at 10am is 50 minutes at 4pm, and a
   * route sequenced on distance alone will miss closing times.
   *
   * Uses `TRAFFIC_AWARE` (not `TRAFFIC_AWARE_OPTIMAL`): the optimal tier costs
   * substantially more per element and this is an n² matrix. Accuracy is
   * adequate for a shopping-day plan.
   *
   * One Routes API call covers the whole matrix, so it bills as a single
   * request against the monthly free tier regardless of stop count.
   *
   * @param waypoints Ordered list; each needs a `placeId` OR lat/lng OR address.
   * @param departureTime Instant to model traffic for. Must be in the future;
   *   the API rejects past departure times, so callers planning a window that
   *   has already begun should pass `new Date()`.
   * @returns `matrix[i][j]` = minutes from waypoint i to waypoint j
   *   (`null` when Google could not route that pair), plus miles.
   * @throws Error('MAPS_QUOTA_EXCEEDED') when the monthly free tier is spent.
   */
  async computeRouteMatrix(
    waypoints: Array<{ placeId?: string; latitude?: number; longitude?: number; address?: string }>,
    departureTime: Date,
  ): Promise<{ minutes: (number | null)[][]; miles: (number | null)[][] }> {
    if (waypoints.length < 2) {
      throw new Error("computeRouteMatrix requires at least 2 waypoints");
    }
    // Routes API caps a matrix at 625 elements (origins × destinations).
    if (waypoints.length > 25) {
      throw new Error(`computeRouteMatrix supports at most 25 waypoints (got ${waypoints.length})`);
    }
    if (!(await this.canUseGoogleMaps())) {
      throw new Error("MAPS_QUOTA_EXCEEDED");
    }

    const gmapKey = await getGoogleMapsApiKey(this.env);

    const toWaypoint = (w: (typeof waypoints)[number]) => {
      if (w.placeId) return { waypoint: { placeId: w.placeId } };
      if (w.latitude != null && w.longitude != null) {
        return { waypoint: { location: { latLng: { latitude: w.latitude, longitude: w.longitude } } } };
      }
      if (w.address) return { waypoint: { address: w.address } };
      throw new Error("Each waypoint needs placeId, lat/lng, or address");
    };

    // The API rejects a departureTime in the past; clamp with a small cushion
    // to survive clock skew between here and Google.
    const departure = new Date(Math.max(departureTime.getTime(), Date.now() + 60_000));

    const body = {
      origins: waypoints.map(toWaypoint),
      destinations: waypoints.map(toWaypoint),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      departureTime: departure.toISOString(),
    };

    const res = await fetch("https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": gmapKey,
        "X-Goog-FieldMask": "originIndex,destinationIndex,duration,distanceMeters,condition",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    const raw = await res.text();
    await this.logUsage("routes:computeRouteMatrix", body, raw.slice(0, 2000), {
      statusCode: res.status,
    });

    if (!res.ok) {
      throw new Error(`ROUTE_MATRIX_ERROR: ${res.status} ${raw.slice(0, 300)}`);
    }

    // computeRouteMatrix streams a JSON array of per-pair elements.
    let elements: Array<{
      originIndex: number;
      destinationIndex: number;
      duration?: string;
      distanceMeters?: number;
      condition?: string;
    }>;
    try {
      elements = JSON.parse(raw);
    } catch {
      throw new Error(`ROUTE_MATRIX_ERROR: unparseable response: ${raw.slice(0, 300)}`);
    }

    const n = waypoints.length;
    const minutes: (number | null)[][] = Array.from({ length: n }, () => Array(n).fill(null));
    const miles: (number | null)[][] = Array.from({ length: n }, () => Array(n).fill(null));

    for (const el of elements) {
      // Protobuf JSON omits default-valued fields, so a missing index means 0
      // rather than "unknown". (Verified against the live API: with these
      // fields in the FieldMask, index 0 IS currently returned explicitly —
      // but defaulting costs nothing and is correct either way. Skipping on
      // undefined would silently drop every leg touching the origin.)
      const i = el.originIndex ?? 0;
      const j = el.destinationIndex ?? 0;
      // ROUTE_NOT_FOUND stays null so the planner can route around it rather
      // than treating an unreachable pair as a zero-minute hop.
      if (el.condition && el.condition !== "ROUTE_EXISTS") continue;
      if (el.duration) minutes[i][j] = Math.round(parseInt(el.duration.replace("s", ""), 10) / 60);
      if (el.distanceMeters != null) miles[i][j] = el.distanceMeters * 0.000621371;
    }

    return { minutes, miles };
  }
}
