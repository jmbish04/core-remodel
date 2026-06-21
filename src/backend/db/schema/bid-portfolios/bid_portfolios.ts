import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { companies } from "../directory/companies";

/**
 * Shareable bid portfolios linked to a company, accessed via unique token URL.
 */
export const bidPortfolios = sqliteTable("bid_portfolios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  companyId: integer("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  title: text("title").notNull(),
  welcomeMessage: text("welcome_message"),
  overviewStatement: text("overview_statement"),
  showBudgetRanges: integer("show_budget_ranges", { mode: "boolean" }).notNull().default(false),
  expirationDate: integer("expiration_date", { mode: "timestamp" }),
  status: text("status").notNull().default("active"), // 'active' | 'expired' | 'archived'
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
