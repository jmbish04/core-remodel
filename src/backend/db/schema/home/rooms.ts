import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { floors } from "./floors";

/**
 * Master room records for the home as-is footprint.
 */
export const rooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  floorId: integer("floor_id")
    .notNull()
    .references(() => floors.id, { onDelete: "cascade" }),
  roomCode: text("room_code").notNull().unique(), // stable identifier (slug)
  roomName: text("room_name").notNull(), // display name
  asIsUse: text("as_is_use"), // current usage label

  // Structured dimension fields, e.g. 15'0" x 24'10"
  lengthFeet: integer("length_feet"),
  lengthInches: integer("length_inches"),
  widthFeet: integer("width_feet"),
  widthInches: integer("width_inches"),

  isLivingSpace: integer("is_living_space", { mode: "boolean" }).notNull().default(true),

  // Known room details for renovation planning.
  problemAreas: text("problem_areas"), // JSON array or freeform
  plumbingNotes: text("plumbing_notes"),
  electricalNotes: text("electrical_notes"),
  structuralNotes: text("structural_notes"),
  hvacNotes: text("hvac_notes"),
  generalNotes: text("general_notes"),
  metadata: text("metadata"), // JSON

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
