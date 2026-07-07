import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

import { brands } from "./brands";

/**
 * Brand intel — one row per brand, produced by the BrandResearchWorkflow
 * (deep-research report + website scrape). Separate 1:1 table so the core
 * `brands` row stays lean while the enrichment payload (long markdown report,
 * JSON blobs) lives here. ALL WRITES ARE FILL-BLANKS from the workflow; the
 * homeowner can overwrite via the brand viewport.
 */
export const brandIntel = sqliteTable(
  "brand_intel",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** 1:1 owner brand. */
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),

    /** 2–3 sentence homeowner-facing AI summary of online reviews/reputation. */
    reviewSummary: text("review_summary"),

    /**
     * Full structured review-insight object (mirrors the showroom
     * `review_ai_insight` shape where applicable): summary, price reasoning,
     * authenticity assessment, notable product lines, etc.
     */
    reviewAiInsight: text("review_ai_insight", { mode: "json" }),

    /**
     * TRUE when the brand can be bought at big-box retailers (Lowe's, Home
     * Depot) or freely online — the "why pay a showroom premium?" flag the
     * viewport surfaces as a warning callout.
     */
    isBigboxAvailable: integer("is_bigbox_available", { mode: "boolean" }),

    /**
     * Structured big-box availability detail:
     * `{ retailers: [{ name, url?, notes? }], onlineOnly?: boolean, rationale: string }`
     */
    bigboxAvailability: text("bigbox_availability", { mode: "json" }).$type<{
      retailers: Array<{ name: string; url?: string | null; notes?: string | null }>;
      onlineOnly?: boolean;
      rationale: string;
    } | null>(),

    /**
     * AI-researched detail on how often the brand runs sales, coupons, or
     * specials (e.g. "Semi-annual sales in May/November; trade discount
     * negotiable year-round"). Markdown-safe prose.
     */
    salesIntel: text("sales_intel"),

    /** Final deep-research report (markdown with inline citation links). */
    researchReport: text("research_report"),

    /**
     * Deep-research source map keyed by short id:
     * `{ "src-1": { title, url, domain, supportedClaims: [...] }, ... }`
     */
    researchSources: text("research_sources", { mode: "json" }),

    /** Workflow lifecycle: idle | pending | running | complete | failed. */
    researchStatus: text("research_status", {
      enum: ["idle", "pending", "running", "complete", "failed"],
    })
      .notNull()
      .default("idle"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    brandUnique: uniqueIndex("brand_intel_brand_uniq").on(table.brandId),
  }),
);

export type BrandIntel = typeof brandIntel.$inferSelect;
export type BrandIntelInsert = typeof brandIntel.$inferInsert;
