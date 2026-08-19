import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { driveLists } from "./drive_lists";
import { driveListStops } from "./drive_list_stops";

/**
 * Drive List Notes — notes attached to a drive, either drive-global or pinned
 * to one location (stop).
 *
 * Unifies what used to be two things: the drive-global note strings in the
 * legacy `drive_lists.notes` JSON column, and (new in 0031) per-location notes.
 * A row with `driveListStopId` null is a general drive note; a row with it set
 * is a note on that stop. One table so both render identically as collapsible
 * alerts in the viewport, with per-note read/collapse state that persists across
 * the Tesla and the phone.
 *
 * `body` is plain text on purpose — these are quick captures typed on a car or
 * phone touchscreen mid-drive (matching the existing plain `drive_list_stops.note`),
 * NOT editorial rich text. Rich showroom notes still use `store_notes` (markdown+html).
 *
 * `source` distinguishes a user note from an AI-generated one — the
 * "AI: follow up on feedback after drive list is completed <date>" reminder the
 * rating flow can create renders with a distinct alert style.
 *
 * `readAt` is the collapse state: null = expanded, set = collapsed. It is a
 * per-note timestamp so "when did I read this" is also recoverable.
 */
export const driveListNotes = sqliteTable(
  "drive_list_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    driveListId: integer("drive_list_id")
      .notNull()
      .references(() => driveLists.id, { onDelete: "cascade" }),

    /** null = drive-global note; set = a note pinned to this stop. */
    driveListStopId: integer("drive_list_stop_id").references(() => driveListStops.id, {
      onDelete: "cascade",
    }),

    /** Plain-text note body (on-the-go capture, not rich text). */
    body: text("body").notNull(),

    /** Who wrote it — `ai` notes (e.g. the deferred-feedback reminder) render distinctly. */
    source: text("source", { enum: ["user", "ai"] })
      .notNull()
      .default("user"),

    /** Collapse state: null = expanded, timestamp = collapsed/read. Persists cross-device. */
    readAt: integer("read_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    driveIdx: index("drive_list_notes_drive_idx").on(table.driveListId),
    stopIdx: index("drive_list_notes_stop_idx").on(table.driveListStopId),
  }),
);

export type DriveListNote = typeof driveListNotes.$inferSelect;
export type DriveListNoteInsert = typeof driveListNotes.$inferInsert;
