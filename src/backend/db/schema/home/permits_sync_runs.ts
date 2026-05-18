import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Audit trail of each SODA permits synchronization run.
 */
export const permitsSyncRuns = sqliteTable("permits_sync_runs", {
  id: text("id").primaryKey(), // UUID
  runType: text("run_type").notNull(), // property | contact
  queryLabel: text("query_label").notNull(),
  sourceDataset: text("source_dataset").notNull(),
  status: text("status").notNull().default("success"), // success | error
  resultCount: integer("result_count").notNull().default(0),
  aiSummary: text("ai_summary"),
  errorText: text("error_text"),
  rawPayload: text("raw_payload"), // JSON response body
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
