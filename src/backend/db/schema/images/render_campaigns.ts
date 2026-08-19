import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * render_campaigns — groups multi-room, multi-angle render work under one
 * design brief and tracks aggregate progress.
 */
export const renderCampaigns = sqliteTable("render_campaigns", {
  id: text("id").primaryKey(), // UUID
  name: text("name").notNull(),
  status: text("status", {
    enum: ["pending", "running", "done", "failed", "paused"],
  })
    .notNull()
    .default("pending"),
  // Design tokens (floorMaterial, wallColor, cabinetColor, counterMaterial,
  // fixtures, lighting…) serialized as JSON.
  designConfig: text("design_config"),
  // Free-form render prompt applied to every angle (per-angle templates are a
  // future follow-up).
  prompt: text("prompt"),
  // Soft reference to the canonical hero render_sessions.id for this campaign.
  heroSessionId: text("hero_session_id"),
  totalAngles: integer("total_angles").notNull().default(0),
  completedAngles: integer("completed_angles").notNull().default(0),
  failedAngles: integer("failed_angles").notNull().default(0),
  // timings, errors, provider metadata as JSON.
  metadata: text("metadata"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeLastModified: integer("datetime_last_modified", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
