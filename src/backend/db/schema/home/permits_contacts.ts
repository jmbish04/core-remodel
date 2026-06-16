import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Known permit contacts discovered from property permit records.
 */
export const permitsContacts = sqliteTable("permits_contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactName: text("contact_name").notNull().unique(),
  isMonitored: integer("is_monitored", { mode: "boolean" }).notNull().default(true),
  activePropertyPermitCount: integer("active_property_permit_count").notNull().default(0),
  closedPropertyPermitCount: integer("closed_property_permit_count").notNull().default(0),
  metadata: text("metadata"), // JSON
  // Identity fields captured from the anchor (open 126 Colby) permit contact,
  // used to gather this contractor's other permits across trades (see SPEC Phase 3).
  licenseNumber: text("license_number"),
  sfBusinessLicenseNumber: text("sf_business_license_number"),
  firmName: text("firm_name"),
  firmAddress: text("firm_address"),
  role: text("role"),
  // JSON string[] of the open 126 Colby permit numbers this contractor is on,
  // and the earliest of their filed dates (the before/after baseline).
  anchorPermitIdentifiers: text("anchor_permit_identifiers"),
  anchorReferenceFiledDate: text("anchor_reference_filed_date"),
  firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
