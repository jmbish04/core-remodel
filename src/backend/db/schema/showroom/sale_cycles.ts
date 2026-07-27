import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

/**
 * Sale Cycles — one row per end-to-end clearance sweep run (0038).
 *
 * A cycle anchors everything a single weekly sweep produces: the per-source
 * scrape runs, the newly-extracted `sale_items`, the cross-cycle diff, the
 * shopping-agent scoring pass, and the weekly PDF ad. `status` walks the
 * pipeline so a resumed/failed run is legible after the fact.
 */
export type SaleCycleStatus =
  | "running"
  | "scraped"
  | "scored"
  | "ad_ready"
  | "emailed"
  | "failed";

export const saleCycles = sqliteTable(
  "sale_cycles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Pipeline stage — see SaleCycleStatus. */
    status: text("status").$type<SaleCycleStatus>().notNull().default("running"),

    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /** Set when the sweep finishes (all sources scraped + diffed). */
    finishedAt: integer("finished_at", { mode: "timestamp" }),

    /** Rollups computed at the end of the sweep — cheap for the store cards + ad. */
    newCount: integer("new_count").notNull().default(0),
    changedCount: integer("changed_count").notNull().default(0),
    goneCount: integer("gone_count").notNull().default(0),
    failedSites: integer("failed_sites").notNull().default(0),

    /** How many deep-research runs this cycle spent — the per-cycle budget guard. */
    deepRunsSpent: integer("deep_runs_spent").notNull().default(0),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    statusIdx: index("sale_cycles_status_idx").on(t.status, t.startedAt),
  }),
);

export type SaleCycle = typeof saleCycles.$inferSelect;
export type SaleCycleInsert = typeof saleCycles.$inferInsert;
