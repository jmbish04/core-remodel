import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { budgetVarianceScenarios } from "./budget_variance_scenarios";

/**
 * Itemized cost deltas for each of the budget variance scenarios.
 * Unpivoted from the "Budget Variance" sheet rows.
 */
export const budgetVarianceLineItems = sqliteTable(
  "budget_variance_line_items",
  {
    id: text("id").primaryKey(),
    scenarioId: integer("scenario_id")
      .notNull()
      .references(() => budgetVarianceScenarios.id, { onDelete: "cascade" }),
    lineItemLabel: text("line_item_label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    costAmount: real("cost_amount"),                     // NULL = not applicable, 0 = explicitly zero
    notes: text("notes"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byScenario: index("idx_bvli_scenario").on(t.scenarioId),
  }),
);

export type BudgetVarianceLineItem = typeof budgetVarianceLineItems.$inferSelect;
export type BudgetVarianceLineItemInsert = typeof budgetVarianceLineItems.$inferInsert;
