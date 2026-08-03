import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The vocabulary of things that can be wrong with a room (0043 Phase 0).
 *
 * Seeded: Water Damage, Active Leak, Code Compliance. A seed, not a closed
 * set — admin-managed at `/admin/config/room/problem-types`.
 *
 * WHAT THIS TYPES: **a problem instance, not a room.** The plan (§2) collapsed
 * an earlier two-table draft (`room_problem_mapping` + `room_problems`) that
 * both claimed to describe "a problem this room has" and therefore made every
 * join ask "which one is the problem?". `room_problems` is the instance; this
 * is only its vocabulary, and the Phase 3 mapping joins
 * `room_problem_id ↔ room_problem_type_id`.
 *
 * MANY TYPES PER PROBLEM, deliberately. An active leak behind a shower wall is
 * genuinely *Active Leak* **and** *Code Compliance* — one defect, two frames,
 * and the contractor, the insurer and the inspector each care about a
 * different one. Forcing a single type would make somebody's view of the same
 * defect disappear.
 *
 * WHAT LIVES ON THE INSTANCE, NOT HERE:
 *  - `severity` and `is_safety_hazard` — these describe *this* leak, not leaks
 *    in general. A slow drip and a live ceiling drop are the same type and not
 *    remotely the same problem.
 *  - `status` (suspected → confirmed → fixing → resolved → accepted →
 *    wont_fix), `discovered_during`, `discovered_at`, `resolved_at`.
 *  - `impact_id` — a problem found during demo IS a `demo_discovery` impact in
 *    the 0041 graph. It links; it does not restate. Do not grow a second
 *    disruption model on this table.
 *
 * The three `description_*` columns carry the plain-language explanation the
 * picker shows. "Code Compliance" means nothing to a first-timer until
 * something tells them it covers work that was legal when it was built and is
 * not legal to leave once the wall is open.
 */
export const roomProblemTypeDef = sqliteTable("room_problem_type_def", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Stable slug, e.g. "active_leak". */
  key: text("key").notNull().unique(),

  /** Display name in plain language, e.g. "Active Leak". */
  name: text("name").notNull(),

  /** Portable source of truth for the explanation — PlateJS markdown. */
  descriptionMarkdown: text("description_markdown"),

  /** Render-ready cache of the same explanation. Sanitized on write. */
  descriptionHtml: text("description_html"),

  /** Flattened text for search and embeddings. */
  descriptionPlaintext: text("description_plaintext"),

  /** Display order in the type picker and on the config page. Lowest first. */
  sortOrder: integer("sort_order").notNull().default(0),

  /**
   * Soft-delete. Retiring a type must never orphan the problems already typed
   * with it — a resolved defect's record is evidence, and evidence that
   * changes shape later is worth less than evidence that does not.
   */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type RoomProblemTypeDef = typeof roomProblemTypeDef.$inferSelect;
export type RoomProblemTypeDefInsert = typeof roomProblemTypeDef.$inferInsert;
