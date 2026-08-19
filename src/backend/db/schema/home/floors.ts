import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Canonical home floor definitions.
 * Example keys: lower_level, upper_level.
 */
export const floors = sqliteTable("floors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  levelOrder: integer("level_order").notNull().default(0),
  livingSqFt: integer("living_sq_ft"),
  notes: text("notes"),

  /**
   * Whether this is a real physical storey (0043 §6).
   *
   * `all_levels` was a SCOPE MARKER smuggled into a table of physical locations —
   * "this applies to the whole house" masquerading as a floor. Floor-wide scope
   * is now handled properly by resolveRoomScope + room_scope_applications, so
   * `all_levels` is marked `is_physical = false` rather than deleted (it has no
   * rooms, but a delete is a data loss and a soft flag is reversible). Room
   * listings and floor pickers filter WHERE is_physical = 1, so a non-floor can
   * never quietly become a floor again. Default true — every real floor is one.
   */
  isPhysical: integer("is_physical", { mode: "boolean" }).notNull().default(true),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
