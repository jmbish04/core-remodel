import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Tracks homeowner read state per permit identifier, so only meaningful
 * field changes trigger a "needs review" badge.
 */
export const permitsIdentifierViews = sqliteTable("permits_identifier_views", {
  permitIdentifier: text("permit_identifier").primaryKey(),
  lastViewedHash: text("last_viewed_hash"),
  lastViewedAt: integer("last_viewed_at", { mode: "timestamp" }),
  viewCount: integer("view_count").notNull().default(0),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
