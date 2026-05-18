import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { images } from "../images/images";
import { planningTaskUpdates } from "./planning_task_updates";

/**
 * Links task updates to uploaded image evidence and optional AI notes.
 */
export const planningTaskUpdateImages = sqliteTable("planning_task_update_images", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskUpdateId: text("task_update_id")
    .notNull()
    .references(() => planningTaskUpdates.id, { onDelete: "cascade" }),
  imageId: text("image_id")
    .notNull()
    .references(() => images.id, { onDelete: "cascade" }),
  aiAnalysis: text("ai_analysis"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
