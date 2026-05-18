import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { planningEpics } from "./planning_epics";
import { planningParticipants } from "./planning_participants";
import { rooms } from "./rooms";

/**
 * Core planning tasks for remodel scheduling and status tracking.
 */
export const planningTasks = sqliteTable("planning_tasks", {
  id: text("id").primaryKey(), // UUID
  epicId: text("epic_id")
    .notNull()
    .references(() => planningEpics.id, { onDelete: "cascade" }),
  roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"), // pending | in_progress | blocked | delayed | done
  priority: integer("priority").notNull().default(2), // 1 high, 2 medium, 3 low
  taskOrder: integer("task_order").notNull().default(0),
  startDate: text("start_date"), // YYYY-MM-DD
  dueDate: text("due_date"), // YYYY-MM-DD
  ownerParticipantId: integer("owner_participant_id").references(
    () => planningParticipants.id,
    { onDelete: "set null" },
  ),
  responsibleParticipantId: integer("responsible_participant_id").references(
    () => planningParticipants.id,
    { onDelete: "set null" },
  ),
  accountableParticipantId: integer("accountable_participant_id").references(
    () => planningParticipants.id,
    { onDelete: "set null" },
  ),
  supportParticipantIds: text("support_participant_ids"), // JSON number[]
  consultedParticipantIds: text("consulted_participant_ids"), // JSON number[]
  informedParticipantIds: text("informed_participant_ids"), // JSON number[]
  dependsOnTaskIds: text("depends_on_task_ids"), // JSON string[]
  metadata: text("metadata"), // JSON
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
