import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// Direct leaf imports — avoid a circular reference through the showroom barrel.
import { showroomStores } from "./stores";
import { showroomStoreLinks } from "./links";

/**
 * A single discounted item pulled off a showroom's clearance/sale page.
 *
 * Every field beyond `title` is nullable because sale pages are wildly
 * inconsistent — some list a price and a percent, most list neither. The
 * extractor writes what it can actually read off the page and leaves the rest
 * null rather than guessing; the /admin/shopping/sales filters are built from
 * whatever is present across the corpus.
 */
export interface ClearanceItem {
  /** Product / offer name as printed on the page. */
  title: string;
  /** Brand, when the page names one. */
  brand: string | null;
  /** Free-text category as printed ("Bath", "Tile", "Floor models"). */
  category: string | null;
  /** Pre-discount price in USD, when stated. */
  originalPrice: number | null;
  /** Discounted price in USD, when stated. */
  salePrice: number | null;
  /** Percent off (0–100), stated or derived from the two prices. */
  discountPercent: number | null;
  /** Sale/clearance framing as printed ("Floor model", "Final sale", "30% off"). */
  dealLabel: string | null;
  /** Deep link to the item, when the page links one out. */
  url: string | null;
  /** Anything else worth keeping — condition notes, quantity, expiry copy. */
  notes: string | null;
}

/**
 * The uniform payload shape stored in `clearanceDetailsJson`. The schema is
 * fixed (as opposed to raw page text) so the sales page can build its filter
 * facets by walking `items[]` without re-parsing HTML.
 */
export interface ClearanceDetails {
  /** Every discounted item the extractor could read off the page. */
  items: ClearanceItem[];
  /** Page-level headline ("Warehouse Sale — up to 60% off"), when present. */
  saleHeadline: string | null;
  /** Page-level end date as printed. Free text — sites never agree on format. */
  saleEndsText: string | null;
  /** Model-written one-paragraph read of what's on offer. */
  summary: string;
}

/**
 * Showroom Store Sales — one row per DISTINCT clearance snapshot per page.
 *
 * The weekly cron re-scans every `WEBSITE_CLEARANCE` link. A
 * row is only written when `contentHash` differs from the newest existing row
 * for that link — an unchanged page produces no row, so the table is a history
 * of actual changes rather than a log of cron runs. The newest row per store is
 * what the showroom viewport surfaces as its clearance alert.
 */
export const showroomStoreSales = sqliteTable(
  "showroom_store_sales",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → showroom_stores.id; deletes cascade with the store. */
    storeId: integer("store_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    /**
     * FK → showroom_store_links.id — the `WEBSITE_CLEARANCE` page this
     * clearance was found on. Nullable + ON DELETE SET
     * NULL so re-classifying a store's links never destroys sale history.
     */
    clearanceWebsiteId: integer("clearance_website_id").references(
      () => showroomStoreLinks.id,
      { onDelete: "set null" },
    ),

    /** Denormalized page URL — survives the link row being re-classified. */
    sourceUrl: text("source_url").notNull(),

    /** When this snapshot was captured. */
    timestamp: integer("timestamp", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /** The uniform extraction payload. @see ClearanceDetails */
    clearanceDetailsJson: text("clearance_details_json", { mode: "json" })
      .$type<ClearanceDetails>()
      .notNull(),

    /**
     * Stable hash of the page's extracted text. The cron compares this against
     * the newest row for the same link and skips the write when equal — this is
     * the "only record when content changed" guard.
     */
    contentHash: text("content_hash").notNull(),

    /**
     * Vectorize id for this snapshot's embedding, so a RAG hit on the sales
     * index maps back to this row. Null when embedding failed (non-fatal).
     */
    ragUuid: text("rag_uuid"),

    /** False once a newer snapshot supersedes this one for the same link. */
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(true),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    storeIdx: index("showroom_store_sales_store_idx").on(t.storeId),
    linkIdx: index("showroom_store_sales_link_idx").on(t.clearanceWebsiteId),
    currentIdx: index("showroom_store_sales_current_idx").on(t.isCurrent, t.timestamp),
    ragIdx: index("showroom_store_sales_rag_idx").on(t.ragUuid),
  }),
);

export type ShowroomStoreSale = typeof showroomStoreSales.$inferSelect;
export type ShowroomStoreSaleInsert = typeof showroomStoreSales.$inferInsert;
