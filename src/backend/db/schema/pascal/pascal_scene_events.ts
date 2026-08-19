import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { pascalVariants } from "./pascal_variants";

/**
 * Pascal scene event (0043) — append-only browser-visible event log per scene.
 * Mirrors the editor's `SceneEvent`: a monotonic integer `eventId` used as the read
 * cursor (`GET /scenes/:id/events?after=<eventId>`), and the full `SceneGraph`
 * snapshot at that version.
 */
export const pascalSceneEvents = sqliteTable("pascal_scene_events", {
  eventId: integer("event_id").primaryKey({ autoIncrement: true }),
  sceneId: text("scene_id")
    .notNull()
    .references(() => pascalVariants.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  kind: text("kind").notNull(),
  // Full Pascal SceneGraph snapshot at this event.
  graphJson: text("graph_json").notNull(),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
