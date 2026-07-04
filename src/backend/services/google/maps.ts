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
  ]
}

Rules for each field:
- inferredPricePoint: map explicit pricing language → budget/cheap/affordable="$", moderate/reasonable/mid-range="$$", mid-to-high/premium/upper-mid="$$$", luxury/very-expensive/high-end-only="$$$$". Mixed signals → central tier. Use "PRICE_LEVEL_UNSPECIFIED" when you consciously find NO pricing signal in the reviews (this is a clean, deliberate exit — NOT an error or a guess). Use null ONLY when the field genuinely cannot be produced.
- priceReasoning: required when inferredPricePoint is one of the $ tiers; null otherwise.
- attributes.tradeRepRequired: true when reviews indicate homeowners are turned away or must bring a trade pro to visit or buy. "Trade-only" pricing games (hidden prices, contractor discounts) are a RED FLAG for homeowners. But if reviews say non-trade visitors were welcomed despite trade-only signage, set value=false and capture that nuance in the rationale.
- attributes.bespokeCurated: true when reviews genuinely rave about unique/mold-breaking selection even without marketing language; false when reviews call the selection overpriced, stale, or generic.
- reviewAuthenticity: USE your Google Search grounding to cross-check whether the Google reviews look genuine vs bought/bot. Look for corroborating discussion on Reddit (r/ subreddit threads like "best tile SF", "best plumber Bay Area") and other sources. Put any URLs you consulted in the sources array.
- brands: extract every brand the showroom carries or affiliates with from reviews + your knowledge. Include websiteUrl as a real URL when known, or empty string.`;

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
          },
          required: [
            "summary",
            "inferredPricePoint",
            "priceReasoning",
            "attributes",
            "reviewAuthenticity",
            "brands",
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
        };

        // ── Helper: extract raw JSON text from a Gemini response ──────────────
        function extractRawJson(geminiResp: unknown): string {
          const raw = (
            (geminiResp as any)?.candidates?.[0]?.content?.parts?.[0]?.text ??
            (geminiResp as any)?.text ??
            ""
          ).trim();
          return raw;
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

        const ai = await createGeminiAiGatewayClient(this.env);
        let parsed: RichReviewInsight | null = null;
        let usedGrounding = false;

        // ── PRIMARY: grounded call (Google Search + free-form JSON in prompt) ─
        try {
          const groundedResponse = await (ai.models.generateContent as Function)({
            model: "gemini-2.5-flash",
            contents: [
              { role: "user", parts: [{ text: userPrompt }] },
            ],
            config: {
              systemInstruction: systemPrompt,
              tools: [{ googleSearch: {} }],
              // NOTE: responseSchema and responseMimeType intentionally omitted —
              // Gemini cannot combine structured JSON mode with grounding tools.
            },
          });

          const rawJson = extractRawJson(groundedResponse);
          if (rawJson) {
            parsed = parseInsightJson(rawJson);
            if (parsed) {
              usedGrounding = true;
              console.info("[placeDetails] Gemini grounded path succeeded.");
            } else {
              console.warn(
                "[placeDetails] Gemini grounded response was not parseable JSON; falling back.",
              );
            }
          }
        } catch (groundedErr) {
          console.warn(
            "[placeDetails] Gemini grounded call failed; falling back to ungrounded JSON mode.",
            groundedErr,
          );
        }

        // ── FALLBACK: no-tools + strict JSON mode ─────────────────────────────
        if (!parsed) {
          const fallbackUserPrompt =
            userPrompt +
            `\n\nIMPORTANT: Google Search is NOT available for this call, so you cannot look up reviews. ` +
            `Base summary/attributes/brands on the review sample above (if any) and your own general knowledge ` +
            `of this business if you have any; otherwise state plainly in the summary that no review data was ` +
            `available for this call. Set reviewAuthenticity.assessment = "UNVERIFIED" and ` +
            `reviewAuthenticity.sources = [] regardless of your confidence.`;

          const fallbackResponse = await (ai.models.generateContent as Function)({
            model: "gemini-2.5-flash",
            contents: [
              { role: "user", parts: [{ text: fallbackUserPrompt }] },
            ],
            config: {
              systemInstruction: systemPrompt,
              responseMimeType: "application/json",
              responseSchema: FALLBACK_RESPONSE_SCHEMA,
            },
          });

          const rawJson = extractRawJson(fallbackResponse);
          if (rawJson) {
            parsed = parseInsightJson(rawJson) ?? (JSON.parse(rawJson) as RichReviewInsight);
            // Enforce UNVERIFIED when grounding wasn't used.
            if (parsed?.reviewAuthenticity) {
              parsed.reviewAuthenticity.assessment = "UNVERIFIED";
              parsed.reviewAuthenticity.sources = [];
            }
            console.info("[placeDetails] Gemini fallback (no-grounding) path succeeded.");
          }
        }

        // ── Write results to data ─────────────────────────────────────────────
        if (parsed) {
          const aiSummary = parsed.summary ?? "";

          data.reviewSummary = {
            text: {
              text: `[gemini summarized] ${aiSummary}`,
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
            _meta: { groundingUsed: usedGrounding, model: "gemini-2.5-flash" },
          };
        }
      } catch (aiErr) {
        // Gemini failure is non-fatal — leave Google's original reviewSummary intact
        // and write no aiInference key. The details response always returns.
        console.error("[placeDetails] Gemini summary failed:", aiErr);
      }
    }

    return data;
  }

  // ─── Commute (existing — untouched) ──────────────────────────────────────

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
}
