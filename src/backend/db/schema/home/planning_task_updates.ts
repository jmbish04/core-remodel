import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { planningParticipants } from "./planning_participants";
import { planningTasks } from "./planning_tasks";

/**
 * Task update log entries (daily/weekly/manual/assistant draft) with approval workflow.
 */
export const planningTaskUpdates = sqliteTable("planning_task_updates", {
  id: text("id").primaryKey(), // UUID
  taskId: text("task_id")
    .notNull()
    .references(() => planningTasks.id, { onDelete: "cascade" }),
  updateDate: text("update_date").notNull(), // YYYY-MM-DD
  status: text("status").notNull(), // pending | in_progress | blocked | delayed | done
  note: text("note"),
  transcript: text("transcript"),
  audioKey: text("audio_key"), // R2 key
  audioMimeType: text("audio_mime_type"),
  source: text("source").notNull().default("manual"), // planning | daily_log | weekly_log | assistant_draft
  createdByParticipantId: integer("created_by_participant_id").references(
    () => planningParticipants.id,
    { onDelete: "set null" },
  ),
  isDraft: integer("is_draft", { mode: "boolean" }).notNull().default(false),
  approvedByParticipantId: integer("approved_by_participant_id").references(
    () => planningParticipants.id,
    { onDelete: "set null" },
  ),
  approvedAt: integer("approved_at", { mode: "timestamp" }),
  metadata: text("metadata"), // JSON
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
