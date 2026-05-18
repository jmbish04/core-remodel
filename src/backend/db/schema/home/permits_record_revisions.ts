import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { permitsSyncRuns } from "./permits_sync_runs";

/**
 * Immutable per-run raw permit records for historical diff and traceability.
 */
export const permitsRecordRevisions = sqliteTable("permits_record_revisions", {
  id: text("id").primaryKey(), // UUID
  runId: text("run_id")
    .notNull()
    .references(() => permitsSyncRuns.id, { onDelete: "cascade" }),
  dataset: text("dataset").notNull(),
  recordKey: text("record_key").notNull(),
  permitNumber: text("permit_number"),
  permitStatus: text("permit_status"),
  rawData: text("raw_data").notNull(), // JSON
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
