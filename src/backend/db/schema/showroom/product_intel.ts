import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

import { showroomStoreProducts } from "./store_products";

/**
 * Product intel — one row per store product, produced by the
 * ProductResearchWorkflow (deep-research report + brand-site scrape). Holds
 * the pricing intelligence the ecommerce viewport surfaces:
 *
 *   - Online price range actually observed in research.
 *   - AI-estimated WHOLESALE price (what the showroom pays the brand),
 *     RETAIL price (what the showroom quotes the homeowner), and the price the
 *     homeowner could plausibly NEGOTIATE to — each with a rationale so the
 *     numbers are auditable, never bare guesses.
 *   - Known sales / money-saving strategies.
 *   - California regulatory friction (e.g. CEC shower flow-rate limits) that
 *     could make acquiring this product difficult.
 *
 * ALL WRITES ARE FILL-BLANKS from the workflow.
 */
export const storeProductIntel = sqliteTable(
  "store_product_intel",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** 1:1 owner product. */
    storeProductId: integer("store_product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    /** 2–3 sentence homeowner-facing AI summary of online product reviews. */
    reviewSummary: text("review_summary"),

    /** Low end of the price range observed online (display string, e.g. "$1,150"). */
    priceRangeLow: text("price_range_low"),

    /** High end of the price range observed online. */
    priceRangeHigh: text("price_range_high"),

    /** AI-estimated wholesale price (showroom's cost from the brand). */
    aiWholesalePrice: text("ai_wholesale_price"),
    /** Why the AI believes the wholesale estimate (margins, trade pricing signals). */
    aiWholesaleRationale: text("ai_wholesale_rationale"),

    /** AI-estimated retail price (showroom's quote to the homeowner). */
    aiRetailPrice: text("ai_retail_price"),
    /** Why the AI believes the retail estimate. */
    aiRetailRationale: text("ai_retail_rationale"),

    /** AI-estimated negotiated price the homeowner could reasonably reach. */
    aiNegotiatedPrice: text("ai_negotiated_price"),
    /** Why the AI believes that negotiation target is achievable. */
    aiNegotiatedRationale: text("ai_negotiated_rationale"),

    /**
     * Known sales for this product + strategies to save money (markdown-safe
     * prose: seasonal sales, open-box, trade pass-through, bundle discounts).
     */
    salesIntel: text("sales_intel"),

    /** TRUE when a California regulation may complicate acquiring this product. */
    caRegulatoryFlag: integer("ca_regulatory_flag", { mode: "boolean" }),

    /**
     * Detail on the California regulatory friction (e.g. "CEC limits
     * showerheads to 1.8 GPM — this 2.5 GPM model cannot be legally sold in
     * CA; look for the -CA variant").
     */
    caRegulatoryNotes: text("ca_regulatory_notes"),

    /** Final deep-research report (markdown with inline citation links). */
    researchReport: text("research_report"),

    /** Deep-research source map keyed by short id (src-1, src-2, …). */
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
    productUnique: uniqueIndex("store_product_intel_product_uniq").on(table.storeProductId),
  }),
);

export type StoreProductIntel = typeof storeProductIntel.$inferSelect;
export type StoreProductIntelInsert = typeof storeProductIntel.$inferInsert;
