import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Contacts for bid portfolios — contractors, architects, civil engineers, etc.
 */
export const contacts = sqliteTable("contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  contactName: text("contact_name").notNull(),
  title: text("title"),
  email: text("email"),
  phone: text("phone"),
  notes: text("notes"),
  isArchived: integer("is_archived", { mode: "boolean" }).notNull().default(false),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
