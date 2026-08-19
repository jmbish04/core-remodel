import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { saleCycles } from "./sale_cycles";
import { showroomStores } from "./stores";
import { showroomStoreLinks } from "./links";

/**
 * Sale Scrape Runs — one row per clearance source per cycle (0038).
 *
 * Powers the "Sale Scan Health" page: which sources were scraped, which came
 * back empty, and — the point — which FAILED so the operator can check them
 * manually. `low_quality` flags a scrape whose extraction was too poorly
 * categorized to trust (see the categorization gate).
 */
export type SaleScrapeStatus =
  | "ok"
  | "empty"
  | "no_new"
  | "failed"
  | "low_quality";

export const saleScrapeRuns = sqliteTable(
  "sale_scrape_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → sale_cycles.id; deletes cascade with the cycle. */
    cycleId: integer("cycle_id")
      .notNull()
      .references(() => saleCycles.id, { onDelete: "cascade" }),

    /** FK → showroom_stores.id. Nullable so store deletes don't wipe run history. */
    storeId: integer("store_id").references(() => showroomStores.id, {
      onDelete: "set null",
    }),

    /** FK → showroom_store_links.id — the WEBSITE_CLEARANCE link scraped. */
    clearanceLinkId: integer("clearance_link_id").references(
      () => showroomStoreLinks.id,
      { onDelete: "set null" },
    ),

    /** Denormalized URL — survives the link row being re-classified/deleted. */
    sourceUrl: text("source_url").notNull(),

    status: text("status").$type<SaleScrapeStatus>().notNull(),

    itemsFound: integer("items_found").notNull().default(0),
    itemsNew: integer("items_new").notNull().default(0),

    /** Populated when status = failed / low_quality. */
    errorText: text("error_text"),

    durationMs: integer("duration_ms"),

    scrapedAt: integer("scraped_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    cycleIdx: index("sale_scrape_runs_cycle_idx").on(t.cycleId),
    storeIdx: index("sale_scrape_runs_store_idx").on(t.storeId, t.scrapedAt),
    statusIdx: index("sale_scrape_runs_status_idx").on(t.status),
  }),
);

export type SaleScrapeRun = typeof saleScrapeRuns.$inferSelect;
export type SaleScrapeRunInsert = typeof saleScrapeRuns.$inferInsert;
