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

    // ── Gemini review summary + structured inference (via AI Gateway) ────────
    // Replace Google's `reviewSummary` (which duplicates `generativeSummary`)
    // with a Gemini structured response routed through the Cloudflare AI Gateway
    // (google-ai-studio path). Yields four fields:
    //   summary              — 2-3 sentence homeowner-facing précis  (→ reviewSummary)
    //   inferred_price_point — "$"|"$$"|"$$$"|"$$$$"|null            (→ aiInference)
    //   price_reasoning      — quoted phrase(s) from reviews         (→ aiInference)
    //   is_large_selection   — warehouse/outlet/huge-inventory flag  (→ aiInference)
    //
    // On any Gemini failure: block skipped entirely; Google's original reviewSummary
    // is left intact and no `aiInference` key is written.
    const reviews = data.reviews as
      | Array<{
          rating?: number;
          text?: { text?: string };
          originalText?: { text?: string };
          relativePublishTimeDescription?: string;
        }>
      | undefined;

    if (Array.isArray(reviews) && reviews.length > 0) {
      try {
        const rating = data.rating as number | undefined;
        const userRatingCount = data.userRatingCount as number | undefined;
        const placeId = data.id as string | undefined;
        const displayName = (data.displayName as { text?: string } | undefined)?.text;
        const formattedAddress = data.formattedAddress as string | undefined;
        const googleMapsUri =
          (data.googleMapsUri as string | undefined) ??
          (placeId ? `https://www.google.com/maps/place/?q=place_id:${placeId}` : undefined);

        const sample = reviews.slice(0, 5);
        const n = sample.length;

        const reviewLines = sample
          .map((r, i) => {
            const stars = r.rating != null ? `${r.rating}/5` : "no rating";
            const body = r.text?.text ?? r.originalText?.text ?? "(no text)";
            const when = r.relativePublishTimeDescription ?? "";
            return `Review ${i + 1} (${stars}${when ? `, ${when}` : ""}): ${body}`;
          })
          .join("\n");

        const placeContext = [
          displayName ? `Business: ${displayName}` : null,
          formattedAddress ? `Address: ${formattedAddress}` : null,
          googleMapsUri ? `Google Maps URL: ${googleMapsUri}` : null,
          placeId ? `Place ID: ${placeId}` : null,
          rating != null ? `Overall rating: ${rating}/5 (${userRatingCount ?? "unknown"} total reviews)` : null,
        ]
          .filter(Boolean)
          .join("\n");

        const prompt =
          `You are writing for a HOMEOWNER (not a designer or trade pro) who is deciding whether to visit and buy from this Bay Area remodel showroom. ` +
          `Give a FAIR, balanced summary — strengths and any caveats (trade-only vibes, appointment requirements, pricing).\n\n` +
          `PLACE CONTEXT:\n${placeContext}\n\n` +
          `REVIEW SAMPLE (${n} of ${userRatingCount ?? "unknown"} total reviews, overall ${rating ?? "unknown"}/5 stars):\n${reviewLines}\n\n` +
          `Instructions:\n` +
          `1. Write 2-3 concise, factual sentences on overall sentiment and what stands out. ` +
          `Note that this is based on a sample of ${n} of ${userRatingCount ?? "unknown"} reviews and whether the sample seems consistent with the ${rating ?? "unknown"}-star average. No marketing fluff.\n` +
          `2. Infer a price tier ONLY from explicit pricing language in the reviews: ` +
          `budget/cheap/affordable → "$"; moderate/reasonable/mid-range → "$$"; mid-to-high/premium/upper-mid → "$$$"; luxury/very expensive/high-end-only → "$$$$". ` +
          `If reviews mix tiers (e.g. "affordable tile" AND "mid-to-high-end slabs"), pick the CENTRAL tier ("$$" or "$$$") and explain in price_reasoning. ` +
          `Return null for inferred_price_point when there is no pricing signal. Quote the relevant phrase(s) in price_reasoning.\n` +
          `3. Set is_large_selection = true when reviews mention a large/extensive selection, outlet, warehouse, huge inventory, "shifting inventory", or lots of options; else false.\n\n` +
          `Respond ONLY with a JSON object — no prose outside the JSON.`;

        // Gemini responseSchema for structured JSON output.
        const REVIEW_INSIGHT_SCHEMA = {
          type: "OBJECT",
          properties: {
            summary: { type: "STRING" },
            inferred_price_point: {
              type: "STRING",
              nullable: true,
              enum: ["$", "$$", "$$$", "$$$$"],
            },
            price_reasoning: { type: "STRING" },
            is_large_selection: { type: "BOOLEAN" },
          },
          required: ["summary", "inferred_price_point", "price_reasoning", "is_large_selection"],
        };

        const ai = await createGeminiAiGatewayClient(this.env);
        const geminiResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: REVIEW_INSIGHT_SCHEMA,
          },
        } as Parameters<typeof ai.models.generateContent>[0]);

        // Extract text from the standard Gemini candidate parts shape.
        const rawJson = (
          (geminiResponse as any)?.candidates?.[0]?.content?.parts?.[0]?.text ??
          (geminiResponse as any)?.text ??
          ""
        ).trim();

        if (rawJson) {
          type ReviewInsight = {
            summary?: string;
            inferred_price_point?: "$" | "$$" | "$$$" | "$$$$" | null;
            price_reasoning?: string;
            is_large_selection?: boolean;
          };

          let parsed: ReviewInsight | null = null;

          try {
            parsed = JSON.parse(rawJson) as ReviewInsight;
          } catch {
            // Gemini output is not valid JSON — use raw text as the summary
            // and skip structured inference fields.
            console.warn("[placeDetails] Gemini returned non-JSON; using raw as summary.");
          }

          const aiSummary = parsed?.summary ?? rawJson;

          data.reviewSummary = {
            text: {
              text: `[gemini summarized] ${aiSummary}`,
              languageCode: "en",
            },
          };

          if (parsed) {
            data.aiInference = {
              inferredPricePoint: parsed.inferred_price_point ?? null,
              priceReasoning: parsed.price_reasoning ?? null,
              isLargeSelection: !!parsed.is_large_selection,
            };
          }
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
