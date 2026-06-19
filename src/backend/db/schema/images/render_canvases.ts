import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";
import { images } from "./images";
import { listingPhotos } from "./listing_photos";
import { renderSessions } from "./render_sessions";

/**
 * render_canvases — a node in the staged render state tree. Every stage output is
 * persisted so later edits / branches reuse cached intermediate state (base ->
 * rough-in -> finish; plus inspiration extraction/synthesis nodes).
 */
export const renderCanvases = sqliteTable("render_canvases", {
  id: text("id").primaryKey(), // UUID
  sessionId: text("session_id")
    .notNull()
    .references(() => renderSessions.id, { onDelete: "cascade" }),
  roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
  // Which angle (blank-canvas listing photo) this canvas belongs to.
  listingPhotoId: integer("listing_photo_id").references(() => listingPhotos.id, {
    onDelete: "set null",
  }),
  // Stage taxonomy (see plan §3).
  type: text("type", {
    enum: [
      "stage_0_LP_unfurnished",
      "stage_1_LP_base",
      "stage_2_LP_rough_in",
      "stage_3_LP_finish",
      "stage_5_LP_synthesis",
      "stage_0_IP_extraction",
      "stage_1_IP_finish",
    ],
  }).notNull(),
  // Lineage: NULL for a tree root, otherwise the parent canvas id (soft self-reference,
  // mirroring image_edit_revisions.parentId).
  parentCanvasId: text("parent_canvas_id"),
  branchLabel: text("branch_label").notNull().default("A"),
  lightingProfile: text("lighting_profile", {
    enum: ["default", "day", "night"],
  })
    .notNull()
    .default("default"),
  prompt: text("prompt"),
  provider: text("provider"), // gemini | fal | replicate
  model: text("model"),
  inputCfImageId: text("input_cf_image_id"), // Cloudflare Images id of the stage input
  outputCfImageId: text("output_cf_image_id"), // Cloudflare Images id of the result
  outputImageId: text("output_image_id").references(() => images.id, {
    onDelete: "set null",
  }),
  // Soft FK to mood_board_generations.id — the mood board auto-generated for a finished render.
  moodBoardId: text("mood_board_id"),
  status: text("status", { enum: ["pending", "done", "failed"] })
    .notNull()
    .default("pending"),
  // image_config used, QA verdict, resolvedModel/provider/fallbackTriggered, timings… as JSON.
  metadata: text("metadata"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
