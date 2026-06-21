import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { floors } from "../home/floors";
import { rooms } from "../home/rooms";

/**
 * AI-generated mood boards (distinct from the manual `mood_boards` table). Stores the
 * generation request (prompt + source images), the generated board image, and a
 * Workers-AI summary (ai_title / ai_description). Servable by room / floor / keywords.
 */
export const moodBoardGenerations = sqliteTable("mood_board_generations", {
  id: text("id").primaryKey(), // UUID
  /** User's natural-language prompt / context (nullable — image-only generation). */
  prompt: text("prompt"),
  /** JSON array of source images sent in: [{ id, url }] (nullable — prompt-only). */
  sourceImages: text("source_images"),
  /** The generated mood-board image. */
  outputCfImageId: text("output_cf_image_id"),
  outputImageUrl: text("output_image_url"),
  /** Workers AI (llama-3.2-11b-vision) summary of the generated board. */
  aiTitle: text("ai_title"),
  aiDescription: text("ai_description"),
  roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
  floorId: integer("floor_id").references(() => floors.id, { onDelete: "set null" }),
  model: text("model"),
  /** Where it came from: "image_edit" (auto, from a finished render) | "manual" | "api". */
  source: text("source"),
  status: text("status", { enum: ["pending", "done", "failed"] })
    .notNull()
    .default("done"),
  isShared: integer("is_shared", { mode: "boolean" }).notNull().default(false),
  metadata: text("metadata"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
