import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The vocabulary of ways a room problem can be addressed (0043 Phase 0).
 *
 * Seeded: Remediation, Drainage Installation. A seed, not a closed set —
 * admin-managed at `/admin/config/room/problem-fix-types`.
 *
 * WHY A FIX IS ITS OWN VOCABULARY, separate from the problem type: the same
 * defect has several legitimate answers at different prices, and the choice
 * between them is the decision the homeowner is actually making. "Water damage"
 * can be answered by remediation alone, by remediation plus drainage, or by
 * regrading outside the house entirely. A schema that let a problem carry only
 * one implied fix would hide the comparison that matters.
 *
 * MANY FIXES PER PROBLEM. The Phase 3 mapping (`room_problem_fix_mapping`)
 * joins `room_problem_id ↔ room_problem_fix_def_id`, so a problem can carry
 * several candidate or applied fixes at once.
 *
 * WHAT LIVES ON THE MAPPING, NOT HERE:
 *  - Cost (`estimated_cost_text` + `estimated_cost_cents`) and the owning
 *    `company_id`. "What will this cost and who does it" is per problem, not
 *    per fix kind — drainage at this house is not drainage in general — and
 *    without those two columns the fix list can never reach the budget.
 *  - The three-format notes describing what was actually proposed or done.
 *
 * WHAT IS NOT HERE AT ALL: whether the fix worked. That is the problem's
 * `status` lifecycle plus a `SOLUTION_AS_BUILT` photo, which is what proves a
 * fix happened when a defect recurs and memories differ.
 */
export const roomProblemFixDef = sqliteTable("room_problem_fix_def", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Stable slug, e.g. "drainage_installation". */
  key: text("key").notNull().unique(),

  /** Display name in plain language, e.g. "Drainage Installation". */
  name: text("name").notNull(),

  /**
   * What this fix actually involves, in plain language — PlateJS markdown.
   * This is the column that lets a homeowner tell remediation and drainage
   * apart before a contractor explains it to them, which is the difference
   * between choosing a fix and being handed one.
   */
  descriptionMarkdown: text("description_markdown"),

  /** Render-ready cache of the same explanation. Sanitized on write. */
  descriptionHtml: text("description_html"),

  /** Flattened text for search and embeddings. */
  descriptionPlaintext: text("description_plaintext"),

  /** Display order in the fix picker and on the config page. Lowest first. */
  sortOrder: integer("sort_order").notNull().default(0),

  /** Soft-delete — a retired fix kind keeps historical fix records readable. */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type RoomProblemFixDef = typeof roomProblemFixDef.$inferSelect;
export type RoomProblemFixDefInsert = typeof roomProblemFixDef.$inferInsert;
