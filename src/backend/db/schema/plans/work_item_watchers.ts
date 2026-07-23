import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex, index } from "drizzle-orm/sqlite-core";

import { planningParticipants } from "../home/planning_participants";

/**
 * Work-item watchers — the permission substrate for 0028.
 *
 * This is the table the whole access model hangs off, and it is deliberately
 * SOURCE-GENERIC: a watcher points at a work item by `(source, item_native_id)`
 * rather than a typed FK, because the items it governs live in two different
 * tables (`plan_tasks`, `planning_tasks`) and a third arrives later (ClickUp).
 *
 * It is written and enforced starting from the barest possible seam: today every
 * authenticated caller is the homeowner (a single shared-password cookie), so
 * `viewerContext()` returns `{ isAdmin: true }` and visibility filtering is a
 * no-op. This table exists now so that when 0029 lands real per-person logins,
 * ONLY `viewer.ts` changes — the data model is already in place.
 *
 * `can_edit` defaults to true because the brief is "assume everyone who is added
 * to something can see AND edit it"; flipping it to 0 makes a row view-only with
 * no migration.
 *
 * No denormalized name column: the person's display name is resolved by JOIN to
 * `planning_participants` at read time.
 */
export const workItemWatchers = sqliteTable(
  "work_item_watchers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Which table the watched item lives in. */
    source: text("source", { enum: ["plan", "planning", "clickup"] }).notNull(),

    /**
     * The item's primary key WITHIN its source table, as text. `plan_tasks.id`
     * is an integer and `planning_tasks.id` is a uuid, so text is the only shape
     * that holds both; a query casts as needed when joining back.
     */
    itemNativeId: text("item_native_id").notNull(),

    /** The watching person. */
    participantId: integer("participant_id")
      .notNull()
      .references(() => planningParticipants.id, { onDelete: "cascade" }),

    /** owner drives it · assignee does it · cc is kept informed · approver signs off. */
    role: text("role", { enum: ["owner", "assignee", "cc", "approver"] }).notNull(),

    /** Whether this person may edit the item. Enforcement stubbed in P0. */
    canEdit: integer("can_edit", { mode: "boolean" }).notNull().default(true),

    /** Who attached this watcher (for an audit trail later). Nullable. */
    addedByParticipantId: integer("added_by_participant_id").references(
      () => planningParticipants.id,
      { onDelete: "set null" },
    ),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    /** At most one row per (item, person, role) — attaching twice is idempotent. */
    watcherUniq: uniqueIndex("work_item_watchers_uniq").on(
      t.source,
      t.itemNativeId,
      t.participantId,
      t.role,
    ),
    /** "What is this person watching?" — the visibility query's driving index. */
    participantIdx: index("work_item_watchers_participant_idx").on(t.participantId),
    /** "Who watches this item?" */
    itemIdx: index("work_item_watchers_item_idx").on(t.source, t.itemNativeId),
  }),
);

export type WorkItemWatcher = typeof workItemWatchers.$inferSelect;
export type WorkItemWatcherInsert = typeof workItemWatchers.$inferInsert;
