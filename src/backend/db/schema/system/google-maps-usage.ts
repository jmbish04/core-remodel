import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { randomUUID } from "node:crypto";

/**
 * Google Maps Usage Log — append-only record of every call made to the
 * Google Maps Platform APIs (Places, Routes, etc.).
 *
 * Purpose: guard against accidentally exceeding the $200 free-tier monthly
 * credit. Every outbound Maps API call from GoogleMapsService must write a
 * row here so the homeowner dashboard can surface spend-to-date.
 *
 * Design notes:
 * - Append-only; rows are NEVER updated or deleted.
 * - All new columns added in 2026-07 migration are NULLABLE so that the
 *   existing GoogleMapsService.logUsage() callsite requires zero changes.
 * - `api_request` / `api_response` preserve the raw payloads for debugging
 *   and future cost-attribution queries.
 * - `session_token` allows grouping an autocomplete keystroke sequence with
 *   its terminal Places Details call so cost is billed as one session.
 */
export const googleMapsUsage = sqliteTable("google_maps_usage_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),

  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),

  /**
   * High-level API category, e.g. 'places', 'routes'.
   * Set by the calling service; not the same as `endpoint` (which is the
   * normalized sub-operation label within that category).
   */
  apiType: text("api_type").notNull(), // e.g., 'places', 'routes'

  /** Full JSON payload or query-parameter object sent to the API. */
  apiRequest: text("api_request", { mode: "json" }).notNull(),

  /** Full JSON response payload received from the API. */
  apiResponse: text("api_response", { mode: "json" }).notNull(),

  // ── 2026-07 extensions (nullable; existing callsites unaffected) ──────

  /**
   * Normalized endpoint label identifying the specific Maps operation.
   *
   * Examples:
   *   'autocomplete'           — Places Autocomplete
   *   'details'                — Places Details
   *   'places:searchText'      — New Places API text-search
   *   'routes:computeRoutes'   — Routes API
   *
   * Used for per-endpoint cost attribution and quota monitoring.
   * Nullable — omitted by legacy callers.
   */
  endpoint: text("endpoint"),

  /**
   * Google Places Autocomplete session token.
   *
   * Autocomplete charges per-character until a Places Details call with the
   * same token closes the session; at that point the whole sequence is billed
   * as a single "session" at the Details price. Storing the token here lets
   * us join autocomplete + details rows to verify session integrity and
   * audit cost correctly.
   *
   * Nullable — only present on autocomplete and the closing details call.
   */
  sessionToken: text("session_token"),

  /**
   * HTTP status code returned by the Google Maps API response.
   *
   * Useful for distinguishing billable successes (200) from quota errors
   * (429), auth failures (403), and transient errors (5xx) without parsing
   * the full `api_response` JSON blob.
   *
   * Nullable — omitted by legacy callers that pre-date this column.
   */
  statusCode: integer("status_code"),
});

// ── Table-level metadata ──────────────────────────────────────────────────────

export const GOOGLE_MAPS_USAGE_TABLE_DESCRIPTION =
  "Append-only log tracking every usage event of Google Maps APIs to ensure we stay within the $200 free tier.";

export const GOOGLE_MAPS_USAGE_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "Unique identifier for the usage event.",
  timestamp: "Timestamp when the API was called.",
  api_type: "The specific API category called (e.g., 'places', 'routes').",
  api_request: "The JSON payload or query parameters sent to the API.",
  api_response: "The JSON response payload received from the API.",
  endpoint:
    "Normalized endpoint label for the Maps sub-operation (e.g., 'autocomplete', 'details', 'places:searchText', 'routes:computeRoutes'). Nullable.",
  session_token:
    "Google Places Autocomplete session token grouping keystrokes + the terminal Details call into a single billable session. Nullable.",
  status_code:
    "HTTP status code from the Google Maps API response (200 = success, 429 = quota exceeded, etc.). Nullable.",
};

// ── TypeScript inferred types ─────────────────────────────────────────────────

export type GoogleMapsUsage = typeof googleMapsUsage.$inferSelect;
export type GoogleMapsUsageInsert = typeof googleMapsUsage.$inferInsert;
