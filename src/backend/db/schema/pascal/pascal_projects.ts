import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { floors } from "../home/floors";
import { rooms } from "../home/rooms";

/**
 * Pascal render project (0043) — maps a Core-Remodel scope (a floor, a room, or the
 * whole home) to a set of Pascal layout explorations. Core-Remodel remains the system
 * of record; Pascal (the Vercel editor) is a thin rendering client that reads/writes
 * scenes here.
 *
 * `id` is a slug (== Pascal `SceneId`: lowercase alphanumeric + hyphen, <= 64 chars).
 * `coreRemodelProjectId` is the stable identity every scene must echo back in
 * `rendering.coreRemodelProjectId`; the two must match at API boundaries.
 */
export const pascalProjects = sqliteTable("pascal_projects", {
  id: text("id").primaryKey(), // slug <= 64
  coreRemodelProjectId: text("core_remodel_project_id").notNull(),
  name: text("name").notNull(),
  scopeType: text("scope_type", {
    enum: ["floor", "room", "whole_home"],
  }).notNull(),
  // Canonical scope FKs — join for the display name, never store it.
  floorId: integer("floor_id").references(() => floors.id, {
    onDelete: "set null",
  }),
  roomId: integer("room_id").references(() => rooms.id, {
    onDelete: "set null",
  }),
  ownerId: text("owner_id"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeLastModified: integer("datetime_last_modified", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date()),
});
