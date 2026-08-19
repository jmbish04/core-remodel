import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
} from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";
import { showroomStoreSales } from "./sales";
import { saleCycles } from "./sale_cycles";
import { saleResearchClusters } from "./sale_research_clusters";
import { brands } from "../brands/brands";
import { categories } from "../config/categories";
import { subcategories } from "../config/subcategories";

/**
 * Physical condition of a clearance listing. Free-ish, but constrained so the
 * UI can badge it and the triage orchestrator can weigh risk.
 */
export type SaleItemCondition =
  | "new"
  | "floor_model"
  | "open_box"
  | "open_package"
  | "return"
  | "damaged";

/**
 * Cross-cycle change state for a listing, keyed on `matchKey`. Set by the diff
 * pass at the end of each sweep. Drives the store-card badges + watch callouts +
 * the PDF ad "sold / price drop" sections.
 */
export type SaleChangeStatus =
  | "new"
  | "unchanged"
  | "price_drop"
  | "qty_down"
  | "color_gone"
  | "gone"
  | "back";

/** Which shopping-intelligence tier actually ran on this item. */
export type SaleResearchTier =
  | "skipped"
  | "group_surface"
  | "item_surface"
  | "deep";

/**
 * Sale Items — one row per discounted product on a clearance page (0038).
 *
 * This promotes the old `showroom_store_sales.clearanceDetailsJson.items[]` JSON
 * blob into real rows so the page can filter by type/color/size, attach per-item
 * images, watch a single listing, diff it across weeks, and hang a deal score +
 * agent insight off it. The parent snapshot row still exists (full page markdown
 * + content hash); this is its exploded, queryable form.
 *
 * FK-not-name: brand/category/subcategory/color are FKs into the shared config
 * vocabularies (JOIN for the display name). The paired `*Text` columns keep the
 * verbatim string the page printed when we could not confidently match an id —
 * never a denormalized copy of a resolved row's name.
 */
export const saleItems = sqliteTable(
  "sale_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → showroom_store_sales.id — the page snapshot this was extracted from. */
    saleSnapshotId: integer("sale_snapshot_id")
      .notNull()
      .references(() => showroomStoreSales.id, { onDelete: "cascade" }),

    /** FK → showroom_stores.id — denormalized for cheap store-scoped queries. */
    storeId: integer("store_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    /** FK → sale_cycles.id — the sweep that most recently observed this row. */
    cycleId: integer("cycle_id").references(() => saleCycles.id, {
      onDelete: "set null",
    }),

    /** Product / offer name as printed. Always present. */
    title: text("title").notNull(),

    // --- identity (FK + verbatim fallback text) ---
    brandId: integer("brand_id").references(() => brands.id, {
      onDelete: "set null",
    }),
    brandText: text("brand_text"),
    productLine: text("product_line"),
    modelName: text("model_name"),
    sku: text("sku"),

    categoryId: integer("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    subcategoryId: integer("subcategory_id").references(
      () => subcategories.id,
      { onDelete: "set null" },
    ),
    /** Verbatim category/type text when no id could be matched. */
    categoryText: text("category_text"),
    /** Free-text size / dimensions ("36 in", "5 ft"). Not a bounded vocab. */
    sizeText: text("size_text"),

    // --- money (text display + integer cents), per the repo currency rule ---
    originalPrice: text("original_price"),
    originalPriceCents: integer("original_price_cents"),
    salePrice: text("sale_price"),
    salePriceCents: integer("sale_price_cents"),
    discountAmount: text("discount_amount"),
    discountAmountCents: integer("discount_amount_cents"),
    discountPct: real("discount_pct"),
    shipping: text("shipping"),
    shippingCents: integer("shipping_cents"),

    /** Sale framing / terms as printed ("Final sale", "Floor model", "30% off"). */
    dealTerms: text("deal_terms"),

    condition: text("condition")
      .$type<SaleItemCondition>()
      .notNull()
      .default("new"),
    hasWarranty: integer("has_warranty", { mode: "boolean" }),
    warrantyText: text("warranty_text"),
    qty: integer("qty"),

    /** Damage / condition notes — rich text (markdown source + html cache). */
    damageNotesMarkdown: text("damage_notes_markdown"),
    damageNotesHtml: text("damage_notes_html"),

    /** Deep link to the listing, when the page links one out. */
    sourceUrl: text("source_url"),

    /**
     * Diff anchor across cycles: source_url -> sku -> normalized brand+model.
     * Populated by the extractor; the diff pass matches on it.
     */
    matchKey: text("match_key"),

    firstSeenCycle: integer("first_seen_cycle"),
    lastSeenCycle: integer("last_seen_cycle"),
    /** False once the item is not found in a later cycle (SOLD / delisted). */
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(true),

    changeStatus: text("change_status")
      .$type<SaleChangeStatus>()
      .notNull()
      .default("new"),
    /** Prior cycle's sale price cents — powers "was $X now $Y". */
    prevSalePriceCents: integer("prev_sale_price_cents"),

    // --- shopping intelligence (triage + agent) ---
    dealScore: integer("deal_score"),
    dealSavingsCents: integer("deal_savings_cents"),
    dealInsightMarkdown: text("deal_insight_markdown"),
    dealInsightHtml: text("deal_insight_html"),
    dealScoredAt: integer("deal_scored_at", { mode: "timestamp" }),
    researchTier: text("research_tier").$type<SaleResearchTier>(),
    /** Surface-pass confidence 0-100 — informs escalation. */
    researchConfidence: integer("research_confidence"),
    /** Why this tier / why escalated / "deep suggested but gated". */
    researchReason: text("research_reason"),
    /** FK → sale_research_clusters.id when scored as part of a group. */
    researchClusterId: integer("research_cluster_id").references(
      () => saleResearchClusters.id,
      { onDelete: "set null" },
    ),
    /**
     * research_jobs id when a deep-research run was spent on this item. Kept as
     * a plain int (not a hard FK) to avoid coupling the sales schema to the
     * research domain's lifecycle. ponytail: promote to an FK if the research
     * job table stabilizes and cross-domain deletes need cascading.
     */
    deepResearchRef: integer("deep_research_ref"),

    // --- user state ---
    /** When the operator first opened this item (drives "new / unread" badges). */
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
    /** Set when the operator marks the item "not interested". */
    dismissedAt: integer("dismissed_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    snapshotIdx: index("sale_items_snapshot_idx").on(t.saleSnapshotId),
    storeIdx: index("sale_items_store_idx").on(t.storeId),
    cycleIdx: index("sale_items_cycle_idx").on(t.cycleId),
    brandIdx: index("sale_items_brand_idx").on(t.brandId),
    subcategoryIdx: index("sale_items_subcategory_idx").on(t.subcategoryId),
    currentIdx: index("sale_items_current_idx").on(t.isCurrent, t.changeStatus),
    matchIdx: index("sale_items_match_idx").on(t.storeId, t.matchKey),
    reviewIdx: index("sale_items_review_idx").on(t.reviewedAt, t.dealScore),
  }),
);

export type SaleItem = typeof saleItems.$inferSelect;
export type SaleItemInsert = typeof saleItems.$inferInsert;
