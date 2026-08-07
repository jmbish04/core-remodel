import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";
import { listingPhotos } from "./listing_photos";
import { renderCampaigns } from "./render_campaigns";
import { renderCanvases } from "./render_canvases";
import { renderSessions } from "./render_sessions";

/**
 * render_campaign_angles — one row per (campaign, room, source angle) enrolled
 * in a multi-room render campaign.
 */
export const renderCampaignAngles = sqliteTable("render_campaign_angles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => renderCampaigns.id, { onDelete: "cascade" }),
  roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
  listingPhotoId: integer("listing_photo_id").references(() => listingPhotos.id, {
    onDelete: "set null",
  }),
  isHero: integer("is_hero", { mode: "boolean" }).notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  status: text("status", {
    enum: ["pending", "running", "done", "failed", "skipped"],
  })
    .notNull()
    .default("pending"),
  // The per-room render session created for this angle's room.
  sessionId: text("session_id").references(() => renderSessions.id, {
    onDelete: "set null",
  }),
  // Resulting canvas once the angle finishes rendering.
  canvasId: text("canvas_id").references(() => renderCanvases.id, {
    onDelete: "set null",
  }),
  error: text("error"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeLastModified: integer("datetime_last_modified", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
