import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { permitsSyncRuns } from "./permits_sync_runs";

/**
 * Contact-centric permit records (other work by contractors/contacts).
 */
export const permitsContactActivity = sqliteTable("permits_contact_activity", {
  id: text("id").primaryKey(), // UUID
  contactName: text("contact_name").notNull(),
  dataset: text("dataset").notNull(),
  recordKey: text("record_key"),
  permitIdentifier: text("permit_identifier"),
  applicationNumber: text("application_number"),
  permitNumber: text("permit_number"),
  permitType: text("permit_type"),
  permitStatus: text("permit_status"),
  statusCategory: text("status_category"),
  propertyAddress: text("property_address"),
  issuedDate: text("issued_date"),
  closedDate: text("closed_date"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  runId: text("run_id").references(() => permitsSyncRuns.id, { onDelete: "set null" }),
  rawData: text("raw_data"), // JSON
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
