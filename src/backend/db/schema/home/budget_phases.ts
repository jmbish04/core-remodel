import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Budget execution phases (0035 grid). The vocabulary the time-phased budget
 * grid groups line items under — "Pre-construction & demolition", "Structural
 * & rough-in (MEP)", "Interior architectural finishes", "Exterior &
 * landscaping", etc. Admin-managed at `/admin/config/budget/phases`.
 *
 * WHY A TABLE, NOT A TEXT COLUMN: a phase is a multi-line-item grouping the
 * grid rolls up and draws a progress ring for. Free text would make "Structural"
 * and "structural" two phases and break the rollup — the same reason
 * `room_use_def` and friends exist. `budget_tracker_items.phaseId` is a
 * single-select FK against this table.
 *
 * PHASE IS NOT execution_class. `execution_class` (must_now | future_tbd |
 * option) answers *whether/when* a line is in scope; a phase answers *which
 * stage of the build* it belongs to. Different axes.
 */
export const budgetPhases = sqliteTable(
  "budget_phases",
  {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Stable slug, e.g. "pre_construction". What seeds and code match on. */
  key: text("key").notNull().unique(),

  /** Display name, e.g. "Pre-construction & demolition". */
  name: text("name").notNull(),

  /** What belongs in this phase, in plain language — PlateJS markdown. */
  descriptionMarkdown: text("description_markdown"),

  /** Render-ready cache of the same explanation. Sanitized on write. */
  descriptionHtml: text("description_html"),

  /** Flattened text for search. */
  descriptionPlaintext: text("description_plaintext"),

  /**
   * Optional progress-ring tone override: emerald | amber | danger. When null
   * the grid derives the tone from the phase's spend-vs-allocation. Stored so a
   * homeowner can pin a phase's colour if the derived one misleads.
   */
  tone: text("tone"),

  /** Display order in the grid and pickers. Lowest first. */
  sortOrder: integer("sort_order").notNull().default(0),

  /** Soft-delete. Retiring a phase never rewrites the items once filed under it. */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  },
  (t) => ({
    // Budget Command Center grid (GET /api/budget/grid): WHERE isActive = true
    // ORDER BY sortOrder.
    activeSortIdx: index("idx_budget_phases_active_sort").on(t.isActive, t.sortOrder),
  }),
);

export type BudgetPhase = typeof budgetPhases.$inferSelect;
export type BudgetPhaseInsert = typeof budgetPhases.$inferInsert;
