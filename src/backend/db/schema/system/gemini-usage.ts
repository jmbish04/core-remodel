import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { randomUUID } from "node:crypto";

/**
 * Gemini Usage Log — append-only record of every call made to the Google
 * Gemini API (via `@google/genai`, direct — NOT through Cloudflare AI Gateway,
 * because the new Gemini interactions API is not gateway-compatible).
 *
 * Purpose: independent, first-party accounting of Gemini token consumption so
 * spend can be reconciled against the provider's own dashboard — i.e. so a
 * bogus "you spent $86k" claim can be refuted with our own per-call ledger.
 *
 * Surfaced alongside the Google Maps quota under `/api/admin/integrations`.
 *
 * Design notes (mirrors google_maps_usage_log):
 * - Append-only; rows are NEVER updated or deleted.
 * - Token columns are nullable — a failed call (or a response without
 *   `usageMetadata`) still logs a row, with `status = "error"`.
 * - `feature` labels the calling surface (e.g. "email_classify",
 *   "deep_research", "image_stage") for per-feature cost attribution.
 */
export const geminiUsage = sqliteTable("gemini_usage_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID()),

  timestamp: integer("timestamp", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),

  /** Gemini model id, e.g. "gemini-2.5-flash", "gemini-3-pro-image". */
  model: text("model").notNull(),

  /**
   * Calling surface label for cost attribution, e.g. "email_classify",
   * "deep_research", "image_stage", "maps_enrichment". Defaults to "unknown"
   * when a caller does not pass one.
   */
  feature: text("feature").notNull().default("unknown"),

  /** "ok" when the call returned, "error" when it threw. */
  status: text("status").notNull().default("ok"),

  // ── Token accounting (from response.usageMetadata; nullable) ──────────────

  /** Input/prompt tokens billed. */
  promptTokens: integer("prompt_tokens"),
  /** Output/candidate tokens billed. */
  candidatesTokens: integer("candidates_tokens"),
  /** "Thinking" tokens (Gemini 2.5+ reasoning), when reported. */
  thoughtsTokens: integer("thoughts_tokens"),
  /** Cached-content tokens (billed at the cache rate), when reported. */
  cachedTokens: integer("cached_tokens"),
  /** Total tokens for the call (prompt + candidates + thoughts). */
  totalTokens: integer("total_tokens"),

  /** Optional pre-computed cost estimate (USD). Null until a rate table exists. */
  estimatedCostUsd: real("estimated_cost_usd"),

  /** Error message when `status = "error"` (truncated). */
  errorMessage: text("error_message"),

  /** Small JSON blob of call metadata (model, feature, input sizes) for audit. */
  requestMeta: text("request_meta", { mode: "json" }),
});

// ── Table-level metadata ──────────────────────────────────────────────────────

export const GEMINI_USAGE_TABLE_DESCRIPTION =
  "Append-only log tracking every Gemini API call (tokens + status) for independent spend reconciliation.";

export const GEMINI_USAGE_COLUMN_DESCRIPTIONS: Record<string, string> = {
  id: "Unique identifier for the usage event.",
  timestamp: "Timestamp when the Gemini call completed (or failed).",
  model: "Gemini model id used for the call.",
  feature: "Calling surface label for cost attribution (e.g. 'email_classify').",
  status: "'ok' if the call returned, 'error' if it threw.",
  prompt_tokens: "Input/prompt tokens billed (from usageMetadata). Nullable.",
  candidates_tokens: "Output tokens billed (from usageMetadata). Nullable.",
  thoughts_tokens: "Reasoning/'thinking' tokens (Gemini 2.5+), when reported. Nullable.",
  cached_tokens: "Cached-content tokens, when reported. Nullable.",
  total_tokens: "Total tokens for the call. Nullable.",
  estimated_cost_usd: "Optional pre-computed USD cost estimate. Nullable.",
  error_message: "Error message when status='error'. Nullable.",
  request_meta: "Small JSON blob of call metadata for audit. Nullable.",
};

// ── TypeScript inferred types ─────────────────────────────────────────────────

export type GeminiUsage = typeof geminiUsage.$inferSelect;
export type GeminiUsageInsert = typeof geminiUsage.$inferInsert;
