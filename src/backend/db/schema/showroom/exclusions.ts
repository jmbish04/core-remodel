import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Showroom exclusions (0032 D1 / 0022 §5.7) — the "never surface this place again" set.
 *
 * When a park-find candidate is rejected (or a discovery search result is dismissed),
 * its Google Places id is recorded here so neither the proximity scan (D1) nor the
 * discovery finder (D2) re-surfaces it. Keyed on `placeId` — the stable match key a
 * Places result always carries — with lat/lng + name kept as a human-readable label
 * and a radius fallback for candidates that arrive without a place id.
 *
 * `source` distinguishes a human "not relevant" (`manual`) from an AI pre-filter
 * (`ai`). The reason is a short rich-text note (markdown = source of truth, html =
 * render cache), per the repo's rich-text rule.
 */
export const showroomExclusions = sqliteTable(
  "showroom_exclusions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Google Places id — the match key. Unique when present (one exclusion per place). */
    placeId: text("place_id"),
    /** Human-readable label for the excluded place. */
    name: text("name"),
    latitude: real("latitude"),
    longitude: real("longitude"),

    /** Why it was excluded — rich text (markdown source of truth, html render cache). */
    reasonMarkdown: text("reason_markdown"),
    reasonHtml: text("reason_html"),

    /** Who excluded it: a human ("not relevant") or an AI pre-filter. */
    source: text("source", { enum: ["manual", "ai"] }).notNull().default("manual"),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    // One exclusion per Places id — the scan/finder dedupe key. Partial so multiple
    // place_id-less (radius-only) exclusions can coexist.
    placeUniq: uniqueIndex("showroom_exclusions_place_uniq")
      .on(t.placeId)
      .where(sql`${t.placeId} IS NOT NULL`),
    sourceIdx: index("showroom_exclusions_source_idx").on(t.source),
  }),
);

export type ShowroomExclusion = typeof showroomExclusions.$inferSelect;
export type ShowroomExclusionInsert = typeof showroomExclusions.$inferInsert;
