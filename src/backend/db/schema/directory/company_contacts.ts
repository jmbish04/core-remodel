import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { contacts } from "../bid-portfolios/contacts";
import { companies } from "./companies";

/**
 * Mapping table to associate contacts with companies (Rolodex)
 */
export const companyContacts = sqliteTable("company_contacts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  contactId: integer("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  title: text("title"), // role/title of the contact at this company
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
