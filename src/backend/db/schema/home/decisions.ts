import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { projects } from "./projects";
import { rooms } from "./rooms";

/**
 * The decision graph (0041 Phase 0).
 *
 * A remodel is a versioned dependency graph, not a checklist. The original home
 * was designed by architects with a purpose and structure wrapped around it;
 * changing one thing creates static that has to be resolved somewhere else. This
 * table is where that structure lives.
 *
 * `parentDecisionId` records what a decision was made *under*, so a chain of
 * consequences can be walked in either direction: what did this choice depend
 * on, and what depends on it.
 *
 * `governingIntent` is the thing worth preserving when a decision has to change.
 * The soft-landing principle turns on it: when a constraint kills the preferred
 * option, the product does not jump to the cheapest substitute — it preserves the
 * governing intent, generates an alternative that honours it differently, shows
 * the consequences, and lets the homeowner choose. That is only possible if the
 * intent was written down when the decision was made, which is why this column
 * is not optional in practice even though it is nullable in the schema.
 *
 * Rich text is markdown + html, per project law: markdown is the portable source
 * of truth, html is the render-ready cache.
 */
export const decisions = sqliteTable(
  "decisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    /**
     * The room this decision belongs to. Nullable because some decisions are
     * genuinely project-wide (service upgrade, permit strategy, structural
     * approach) and forcing those into a fake room is exactly the modelling
     * error this plan warns against.
     */
    roomId: integer("room_id").references(() => rooms.id, { onDelete: "cascade" }),

    /** What was decided, in the homeowner's words. */
    title: text("title").notNull(),

    bodyMarkdown: text("body_markdown"),
    bodyHtml: text("body_html"),

    /**
     * The outcome that must survive if this decision has to be revisited.
     * Feeds the soft-landing controller.
     */
    governingIntent: text("governing_intent"),

    /** What this was decided under. Null = a root decision. Self-FK → decisions.id
     * (a decision chains under its parent); ON DELETE SET NULL so removing a parent
     * re-roots its children rather than cascading them away. */
    parentDecisionId: integer("parent_decision_id").references(
      (): AnySQLiteColumn => decisions.id,
      { onDelete: "set null" },
    ),

    /**
     * proposed  an agent or a person suggested it; not project truth yet
     * parked    captured deliberately, uncommitted, keeping why it mattered
     * settled   committed and current
     * reopened  was settled, and something named invalidated it
     * superseded  replaced by a later decision
     * discarded ruled out, and the reason is kept
     */
    status: text("status").notNull().default("proposed"),

    /** Who decided, and what would cause reconsideration. */
    decidedBy: text("decided_by"),
    reconsiderIf: text("reconsider_if"),

    decidedAt: integer("decided_at", { mode: "timestamp" }),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    projectIdx: index("decisions_project_idx").on(table.projectId),
    roomStatusIdx: index("decisions_room_status_idx").on(table.roomId, table.status),
    parentIdx: index("decisions_parent_idx").on(table.parentDecisionId),
  }),
);
