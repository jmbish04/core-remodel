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
  firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
