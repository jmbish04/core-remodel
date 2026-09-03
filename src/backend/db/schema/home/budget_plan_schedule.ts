import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Time-phased planned spend per budget line item, per month (0035 grid).
 *
 * This is the "Estimate" axis of the budget grid: one row = the planned dollars
 * for a single budget line in a single calendar month. Actuals are NOT stored
 * here — they come from `budget_expense_entries` bucketed by `dateIncurred`.
 * Variance = planned − actual, computed at read time.
 *
 * KEYED ON THE STABLE `budget_item_track_id` (TEXT, NO FK): budget items
 * revision in place (`budget_tracker_items` inserts a new row/id, same
 * `trackId`, on every edit), so an FK to the row `id` would dangle. Same
 * deliberate pattern as `budget_item_material_mappings`.
 */
export const budgetPlanSchedule = sqliteTable(
  "budget_plan_schedule",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Stable budget-line identity. Matches `budget_tracker_items.trackId`. */
    budgetItemTrackId: text("budget_item_track_id").notNull(),

    /** Calendar month bucket, "YYYY-MM" (e.g. "2026-02"). */
    period: text("period").notNull(),

    /** Planned amount for this line in this month, integer cents. */
    plannedCents: integer("planned_cents").notNull().default(0),

    /** Verbatim entry as typed (currency rule: store text + cents). */
    plannedText: text("planned_text"),

    /** How the row got here: seed_estimate | manual | sheet. */
    source: text("source").notNull().default("manual"),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    // One planned figure per (line, month). Inline edits upsert on this key.
    uniqueLinePeriod: uniqueIndex("ux_budget_plan_line_period").on(
      table.budgetItemTrackId,
      table.period,
    ),
    // Budget Command Center grid (GET /api/budget/grid): WHERE period BETWEEN
    // from AND to, unscoped by budgetItemTrackId — the unique index above
    // leads with budgetItemTrackId so it can't serve a period-only range
    // scan. This one leads with period instead.
    periodIdx: index("idx_budget_plan_schedule_period").on(table.period),
  }),
);

export type BudgetPlanScheduleRow = typeof budgetPlanSchedule.$inferSelect;
export type BudgetPlanScheduleInsert = typeof budgetPlanSchedule.$inferInsert;
