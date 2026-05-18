import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Project participants for task ownership and RASCI mappings.
 */
export const planningParticipants = sqliteTable("planning_participants", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  displayName: text("display_name").notNull(),
  participantType: text("participant_type").notNull().default("contractor"), // homeowner | contractor | architect | designer | vendor | inspector
  companyName: text("company_name"),
  email: text("email"),
  phone: text("phone"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  metadata: text("metadata"), // JSON
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
