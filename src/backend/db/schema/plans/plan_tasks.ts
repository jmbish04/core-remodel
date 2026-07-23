import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";

import { planningParticipants } from "../home/planning_participants";
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
      // `in_review` added in 0028 so the software board can model code review.
      enum: ["pending", "in_progress", "in_review", "blocked", "deferred", "done"],
    })
      .notNull()
      .default("pending"),

    /** JSON array of taskKeys this task depends on (stringified). */
    dependsOn: text("depends_on", { mode: "json" }).$type<string[]>(),

    // ── 0028: schedule + assignment ──────────────────────────────────────────
    // Additive and nullable. These are what let a plan_task feed a Gantt, a
    // burndown, and a velocity metric — none of which the roadmap tracker had.

    /** ISO date (YYYY-MM-DD). */
    startDate: text("start_date"),
    dueDate: text("due_date"),
    /** 0–100. Null = unknown, distinct from 0. */
    progressPct: integer("progress_pct"),
    effortPoints: integer("effort_points"),
    priority: text("priority", { enum: ["urgent", "high", "medium", "low"] }),
    /** Who is doing it. FK → planning_participants (the shared people table). */
    assigneeParticipantId: integer("assignee_participant_id").references(
      () => planningParticipants.id,
      { onDelete: "set null" },
    ),
    /** The PR that closed this task. Written by `close_plan_task` (P2). */
    prNumber: integer("pr_number"),
    /** Soft link → changelog_entries.slug — the entry that documents this task. */
    changelogSlug: text("changelog_slug"),

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
