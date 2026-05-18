import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { imageEditSessions } from "./image_edit_sessions";
import { images } from "./images";

export const imageEditRevisions = sqliteTable("image_edit_revisions", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .references(() => imageEditSessions.id, { onDelete: "cascade" }),
  parentId: text("parent_id"), // NULL if it is the root image in the tree
  prompt: text("prompt").notNull(),
  startingImageUrl: text("starting_image_url").notNull(),
  outputImageUrl: text("output_image_url").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),

  // Backward-compatible fields retained for existing photo edit session consumers.
  sourceImageId: text("source_image_id").references(() => images.id, {
    onDelete: "set null",
  }),
  outputImageId: text("output_image_id").references(() => images.id, {
    onDelete: "cascade",
  }),
  model: text("model"),
  revisionNumber: integer("revision_number"),
  metadata: text("metadata"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" }).default(sql`(unixepoch())`),
});
