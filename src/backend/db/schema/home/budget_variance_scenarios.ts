import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * High-level layout variance options representing different layout scenarios.
 * Sourced from the "Budget Variance" sheet header columns.
 */
export const budgetVarianceScenarios = sqliteTable("budget_variance_scenarios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scenarioKey: text("scenario_key").notNull().unique(),  // "a", "b", "c", "d"
  label: text("label").notNull(),                        // "Scenario A", "Scenario B", etc.
  kitchenLocation: text("kitchen_location").notNull(),   // "Kitchen Downstairs", "Kitchen Upstairs"
  subLocation: text("sub_location"),                     // e.g. "Living Room (South Wall)"
  layoutType: text("layout_type"),                       // "Galley w/ island", "U-shape", etc.
  plumbingStrategy: text("plumbing_strategy"),           // "Cut through slab for plumbing", etc.
  deviationTotal: real("deviation_total").notNull(),      // A=177284, B=80000, C=117304, D=40000
  notes: text("notes"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type BudgetVarianceScenario = typeof budgetVarianceScenarios.$inferSelect;
export type BudgetVarianceScenarioInsert = typeof budgetVarianceScenarios.$inferInsert;
