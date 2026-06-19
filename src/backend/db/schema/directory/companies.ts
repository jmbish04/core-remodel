import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { businessTypes } from "./business_types";

/**
 * Unified business entities
 */
export const companies = sqliteTable("companies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  businessTypeId: integer("business_type_id")
    .references(() => businessTypes.id, { onDelete: "set null" }),
  phone: text("phone"),
  email: text("email"),
  website: text("website"),
  licenseNumber: text("license_number"),
  notes: text("notes"),
  isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
