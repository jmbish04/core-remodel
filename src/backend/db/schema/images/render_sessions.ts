import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";

/**
 * Render session — groups a room's virtual-staging work and holds the configured
 * design ("the outfit"). A session fans out across the room's blank-canvas angles
 * and produces a tree of render_canvases nodes.
 */
export const renderSessions = sqliteTable("render_sessions", {
  id: text("id").primaryKey(), // UUID
  roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  status: text("status", { enum: ["active", "archived"] })
    .notNull()
    .default("active"),
  // Configured design tokens (floorMaterial, wallColor, cabinetColor, counterMaterial,
  // fixtures, lighting…) serialized as JSON. May later become a FK to a `designs` table.
  designConfig: text("design_config"),
  // Soft reference to the canonical hero render_canvases.id (no hard FK to avoid a
  // render_sessions <-> render_canvases cycle).
  heroCanvasId: text("hero_canvas_id"),
  // 0041 P2: seed inspiration references a session was created from — JSON
  // [{ url, label }]. Populated when a session is spun up from a set of images
  // (e.g. selected showroom photos); surfaced in the studio inspiration rail.
  seedReferenceUrlsJson: text("seed_reference_urls_json"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeLastModified: integer("datetime_last_modified", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
