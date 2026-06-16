import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { permitsSyncRuns } from "./permits_sync_runs";

/**
 * Canonical current-state permit records normalized from SODA datasets.
 */
export const permitsRecords = sqliteTable("permits_records", {
  id: text("id").primaryKey(), // UUID
  dataset: text("dataset").notNull(),
  recordKey: text("record_key").notNull().unique(),
  permitIdentifier: text("permit_identifier"),
  applicationNumber: text("application_number"),
  permitNumber: text("permit_number"),
  permitType: text("permit_type"),
  permitStatus: text("permit_status"),
  statusCategory: text("status_category"),
  propertyAddress: text("property_address"),
  block: text("block"),
  lot: text("lot"),
  contactName: text("contact_name"),
  contactRole: text("contact_role"),
  filedDate: text("filed_date"),
  issuedDate: text("issued_date"),
  expiresDate: text("expires_date"),
  closedDate: text("closed_date"),
  latitude: text("latitude"),
  longitude: text("longitude"),
  isPropertyPermit: integer("is_property_permit", { mode: "boolean" })
    .notNull()
    .default(false),
  isClosed: integer("is_closed", { mode: "boolean" }).notNull().default(false),
  changeHash: text("change_hash"),
  lastChangedAt: integer("last_changed_at", { mode: "timestamp" }),
  latestRunId: text("latest_run_id").references(() => permitsSyncRuns.id, {
    onDelete: "set null",
  }),
  rawData: text("raw_data"), // JSON
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
