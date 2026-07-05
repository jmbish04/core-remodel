import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

import { plans } from "./plans";

/**
 * Plan tasks — the actionable items that make up each plan, rendered as the
 * board on `/admin/plans/[slug]` and updated in place as work progresses.
 *
 * Seeded idempotently by `(planSlug, taskKey)` unique index. Future coding
 * sessions PATCH `status`/`notes` as they complete work; the frontend polls and
 * reflects the change, so progress is tracked across sessions without re-seeding.
 */
export const planTasks = sqliteTable(
  "plan_tasks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → plans.slug (cascade delete when a plan is removed). */
    planSlug: text("plan_slug")
      .notNull()
      .references(() => plans.slug, { onDelete: "cascade" }),

    /** Human-stable key, unique within a plan, e.g. "P1-NAV-01". */
    taskKey: text("task_key").notNull(),

    /** Workstream grouping label, e.g. "navigation", "documents", "recovery". */
    workstream: text("workstream").notNull().default("general"),

    /** Phase ordinal (0 = infra/now, 1..7 = sequenced feature phases). */
    phase: integer("phase").notNull().default(0),

    title: text("title").notNull(),
    description: text("description"),

    /** Target URL/route this task establishes or changes (nullable). */
    targetRoute: text("target_route"),

    /** What kind of change this task represents. */
    changeType: text("change_type", {
      enum: ["new", "move", "update", "delete", "keep", "investigate", "recover"],
    })
      .notNull()
      .default("new"),

    status: text("status", {
      enum: ["pending", "in_progress", "blocked", "deferred", "done"],
    })
      .notNull()
      .default("pending"),

    /** JSON array of taskKeys this task depends on (stringified). */
    dependsOn: text("depends_on", { mode: "json" }).$type<string[]>(),

    /** Display order within a phase (lower = first). */
    sortOrder: integer("sort_order").notNull().default(0),

    /** Freeform notes — resolved decisions, recovery source, blockers, etc. */
    notes: text("notes"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    /** Idempotent seeding: at most one row per (plan, taskKey). */
    planTaskUniq: uniqueIndex("plan_tasks_plan_task_uniq").on(t.planSlug, t.taskKey),
    planIdx: index("plan_tasks_plan_idx").on(t.planSlug),
  }),
);

export type PlanTask = typeof planTasks.$inferSelect;
export type PlanTaskInsert = typeof planTasks.$inferInsert;
