import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Immutable audit trail for every ClickUp task mutation
 * that passes through the Worker.
 *
 * Each row captures the FULL JSON payload BEFORE sending to ClickUp,
 * plus the ClickUp response, enabling complete replay/recovery.
 */
export const clickupRevisionLog = sqliteTable("clickup_revision_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** The ClickUp task ID (e.g. "abc123"). NULL for create ops (assigned after ClickUp responds). */
  clickupTaskId: text("clickup_task_id"),

  /** The ClickUp List ID this task belongs to. */
  clickupListId: text("clickup_list_id"),

  /** create | update | delete | attachment */
  operation: text("operation").notNull(),

  /** Full JSON payload sent TO ClickUp. */
  requestPayload: text("request_payload").notNull(),

  /** Full JSON response FROM ClickUp (or error). */
  responsePayload: text("response_payload"),

  /** HTTP status code from ClickUp. */
  responseStatus: integer("response_status"),

  /** Who triggered this change (email or "system"). */
  actor: text("actor").notNull().default("system"),

  /** Optional: R2 key if an attachment was uploaded. */
  r2AttachmentKey: text("r2_attachment_key"),

  /** ISO-8601 timestamp of the mutation. */
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
