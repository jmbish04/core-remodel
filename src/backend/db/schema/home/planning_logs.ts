import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { planningParticipants } from "./planning_participants";

/**
 * Daily/weekly log documents with PlateJS content and optional audio/transcript.
 */
export const planningLogs = sqliteTable("planning_logs", {
  id: text("id").primaryKey(), // UUID
  logType: text("log_type").notNull(), // daily | weekly
  logDate: text("log_date").notNull(), // YYYY-MM-DD
  title: text("title").notNull(),
  content: text("content").notNull(), // JSON string
  transcript: text("transcript"),
  audioKey: text("audio_key"), // R2 key
  audioMimeType: text("audio_mime_type"),
  authorParticipantId: integer("author_participant_id").references(
    () => planningParticipants.id,
    { onDelete: "set null" },
  ),
  metadata: text("metadata"), // JSON
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
