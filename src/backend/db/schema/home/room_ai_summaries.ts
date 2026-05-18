import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { images } from "../images/images";
import { rooms } from "./rooms";

/**
 * Cached Worker AI summaries and room-level presentation settings.
 * This keeps room overview text and representative-photo choices in D1
 * so the room page does not need to regenerate context on every request.
 */
export const roomAiSummaries = sqliteTable(
  "room_ai_summaries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),
    representativeImageId: text("representative_image_id").references(() => images.id, {
      onDelete: "set null",
    }),
    summaryMarkdown: text("summary_markdown"),
    summaryJson: text("summary_json"),
    lastUserPrompt: text("last_user_prompt"),
    lastVoiceTranscript: text("last_voice_transcript"),
    model: text("model"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    datetimeGenerated: integer("datetime_generated", { mode: "timestamp" }),
  },
  (table) => ({
    roomUnique: uniqueIndex("room_ai_summaries_room_unique").on(table.roomId),
  }),
);
