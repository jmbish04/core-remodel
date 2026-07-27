import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { saleCycles } from "./sale_cycles";

/**
 * Weekly Sale Ad — the mailer-style PDF catalog produced per cycle (0038).
 *
 * Built by Browser Rendering from an HTML template after the cycle is scored,
 * uploaded to R2 (`pdfR2Key`). Surfaced on the sales page as a notification
 * (open in a new tab / print) and emailed with the PDF attached. `topFindsJson`
 * / `failedSitesJson` drive the email overview + the "check manually" callout.
 */
export type WeeklySaleAdStatus =
  | "building"
  | "ready"
  | "emailed"
  | "failed";

export const weeklySaleAd = sqliteTable(
  "weekly_sale_ad",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → sale_cycles.id; deletes cascade with the cycle. */
    cycleId: integer("cycle_id")
      .notNull()
      .references(() => saleCycles.id, { onDelete: "cascade" }),

    /** R2 object key of the rendered PDF. Null until the render succeeds. */
    pdfR2Key: text("pdf_r2_key"),

    /** Overview copy — rich text (markdown source + html cache). */
    summaryMarkdown: text("summary_markdown"),
    summaryHtml: text("summary_html"),

    /** Top finds for the email lede — JSON array of {saleItemId, blurb}. */
    topFindsJson: text("top_finds_json", { mode: "json" }).$type<
      { saleItemId: number; blurb: string }[]
    >(),

    /** Sources that failed to scrape this cycle — JSON array of {sourceUrl, storeId, error}. */
    failedSitesJson: text("failed_sites_json", { mode: "json" }).$type<
      { sourceUrl: string; storeId: number | null; error: string | null }[]
    >(),

    newCount: integer("new_count").notNull().default(0),
    changedCount: integer("changed_count").notNull().default(0),
    goneCount: integer("gone_count").notNull().default(0),

    status: text("status")
      .$type<WeeklySaleAdStatus>()
      .notNull()
      .default("building"),

    generatedAt: integer("generated_at", { mode: "timestamp" }),
    emailSentAt: integer("email_sent_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    cycleIdx: index("weekly_sale_ad_cycle_idx").on(t.cycleId),
  }),
);

export type WeeklySaleAd = typeof weeklySaleAd.$inferSelect;
export type WeeklySaleAdInsert = typeof weeklySaleAd.$inferInsert;
