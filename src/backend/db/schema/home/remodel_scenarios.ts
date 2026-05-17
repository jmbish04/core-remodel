import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Top-level redesign/relocation scenarios.
 * Example: "Kitchen to lower family room".
 */
export const remodelScenarios = sqliteTable("remodel_scenarios", {
  id: text("id").primaryKey(), // UUID
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("draft"), // draft | active | shortlisted | archived
  budgetLowCents: integer("budget_low_cents"),
  budgetHighCents: integer("budget_high_cents"),
  decisionNotes: text("decision_notes"),
  metadata: text("metadata"), // JSON
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
