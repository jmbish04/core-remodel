import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Cookie-scoped visitor sessions for contractor usage analytics.
 */
export const visitorSessions = sqliteTable("visitor_sessions", {
  id: text("id").primaryKey(),
  firstPath: text("first_path"),
  lastPath: text("last_path"),
  firstReferrer: text("first_referrer"),
  lastReferrer: text("last_referrer"),
  userAgent: text("user_agent"),
  country: text("country"),
  city: text("city"),
  timezone: text("timezone"),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
