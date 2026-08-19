import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";
import { renderCampaigns } from "./render_campaigns";
import { renderSessions } from "./render_sessions";

/**
 * render_campaign_sessions — junction linking a campaign to the per-room
 * render_sessions it created. One session per room in a campaign.
 */
export const renderCampaignSessions = sqliteTable("render_campaign_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campaignId: text("campaign_id")
    .notNull()
    .references(() => renderCampaigns.id, { onDelete: "cascade" }),
  sessionId: text("session_id")
    .notNull()
    .references(() => renderSessions.id, { onDelete: "cascade" }),
  roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
  isHero: integer("is_hero", { mode: "boolean" }).notNull().default(false),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
