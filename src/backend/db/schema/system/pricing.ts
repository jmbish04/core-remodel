import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Model price catalog — published list prices, refreshed weekly.
 *
 * WHY THIS EXISTS
 * ---------------
 * `gemini_usage_log.estimated_cost_usd` has existed since that table was created
 * and has had no writer, so /admin/system/agents/usage reports $0 for every
 * provider while 7.5M tokens a cycle move through the system. A cost dashboard
 * that renders $0 is worse than no cost dashboard, because it reads as
 * reassurance.
 *
 * Computing cost needs a price, and prices live in vendor documentation that
 * changes without notice. So they are fetched weekly, normalized to one unit
 * (USD per MILLION tokens) and stored here, where they can be JOINed against
 * the usage log rather than re-parsed on every write.
 *
 * DELIBERATELY D1, NOT KV: the catalog's whole job is to be joined. A KV blob
 * would have to be fetched and parsed inside every `recordUsage` call.
 */
export const modelPricing = sqliteTable(
  "model_pricing",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Matches `gemini_usage_log.provider`. */
    provider: text("provider").notNull(),
    /** Canonical model id, lowercased — the join key with the usage log. */
    model: text("model").notNull(),
    /** Vendor's human label, when the source gives one. */
    displayName: text("display_name"),

    /**
     * USD per MILLION tokens. Input and output are separate columns because
     * output is 3-5x input at every major vendor — a blended rate is not an
     * approximation, it is a wrong answer.
     */
    inputPerMillionUsd: real("input_per_million_usd"),
    outputPerMillionUsd: real("output_per_million_usd"),
    /** Cached/context-reuse input rate. Null when the vendor does not publish one. */
    cachedInputPerMillionUsd: real("cached_input_per_million_usd"),

    /**
     * What the rate is per. Almost always "tokens", but Workers AI prices some
     * models per image or per audio second, and pretending those are tokens
     * would produce confident nonsense.
     */
    unit: text("unit").notNull().default("tokens"),

    /** Where the number came from, so a surprising price is checkable. */
    sourceUrl: text("source_url"),
    /**
     * How it was parsed — which table row, or the neuron figures it was derived
     * from. This is what makes a bad row debuggable instead of mysterious.
     */
    sourceNote: text("source_note"),

    /**
     * Soft-delete. A model withdrawn by its vendor keeps its row so historic
     * cost stays explainable; it just stops being used for new pricing.
     */
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    fetchedAt: integer("fetched_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    // The weekly refresh UPSERTS on this, so the table stays the size of the
    // catalog rather than growing by a full copy every week.
    providerModelUniq: uniqueIndex("model_pricing_provider_model_uniq").on(t.provider, t.model),
    providerIdx: index("model_pricing_provider_idx").on(t.provider),
  }),
);

/**
 * One row per provider per refresh attempt.
 *
 * Exists so a silently broken parser is visible. Zero models parsed is recorded
 * as an ERROR, never as a successful empty refresh — the difference between
 * "this vendor publishes nothing" and "our regex stopped matching" is the whole
 * value of this table.
 */
export const pricingFetchRuns = sqliteTable(
  "pricing_fetch_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    status: text("status", { enum: ["ok", "error", "partial"] }).notNull(),
    modelsFound: integer("models_found").notNull().default(0),
    /** Rows whose price actually changed — a quiet week should read as 0. */
    modelsChanged: integer("models_changed").notNull().default(0),
    errorMessage: text("error_message"),
    durationMs: integer("duration_ms"),
    at: integer("at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({ providerAtIdx: index("pricing_fetch_runs_provider_at_idx").on(t.provider, t.at) }),
);

export type ModelPricing = typeof modelPricing.$inferSelect;
export type PricingFetchRun = typeof pricingFetchRuns.$inferSelect;
