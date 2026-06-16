import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Persisted Worker AI and heuristic analysis per monitored permit contact.
 */
export const permitsContactInsights = sqliteTable("permits_contact_insights", {
  id: text("id").primaryKey(), // UUID
  contactName: text("contact_name").notNull().unique(),
  riskLevel: text("risk_level").notNull().default("medium"), // low | medium | high
  // Per-contractor busyness read relative to the 126 Colby filing date (idle | light | busy).
  beforeBusyness: text("before_busyness"),
  afterBusyness: text("after_busyness"),
  summary: text("summary").notNull(),
  highlights: text("highlights"), // JSON string[]
  metrics: text("metrics"), // JSON
  model: text("model"),
  lastRunId: text("last_run_id"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
