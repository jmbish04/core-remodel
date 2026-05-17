import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { visitorSessions } from "./visitor_sessions";

/**
 * Individual client events (views, clicks, dwell-time) for admin analytics.
 */
export const visitorEvents = sqliteTable("visitor_events", {
  id: text("id").primaryKey(),
  visitorId: text("visitor_id")
    .notNull()
    .references(() => visitorSessions.id, { onDelete: "cascade" }),
  sessionId: text("session_id"),
  eventType: text("event_type").notNull(), // page_view | click | page_exit
  path: text("path").notNull(),
  element: text("element"),
  durationMs: integer("duration_ms"),
  referrer: text("referrer"),
  metadata: text("metadata"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
