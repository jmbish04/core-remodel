import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Photo viewer notes — contractor / professional feedback on individual images.
 *
 * These notes are left by read-only viewers (contractors, professionals, etc.)
 * on the Photo Collection Viewport pages (`/listing-photos`, `/inspiration-photos`).
 * They allow anyone viewing the photos to leave questions, observations, or
 * feedback that the homeowner or admin can later review and respond to.
 *
 * The table is intentionally simple: one note per row, no threading. Notes are
 * displayed chronologically under each image in the viewport, and the author's
 * display name + role are captured at write time so the note is self-contained
 * without a foreign key to a users table (external contractors may not have
 * system accounts).
 */
export const photoViewerNotes = sqliteTable(
  "photo_viewer_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** The image this note is attached to (FK to images.id by convention, not enforced). */
    imageId: text("image_id").notNull(),

    /** Display name of the author (e.g. "Mike — GC", "Sarah from Tile Co"). */
    authorName: text("author_name"),

    /** Role tag — "contractor" | "homeowner" | "admin" | "vendor". */
    authorRole: text("author_role"),

    /** The note body — free-form text, no length limit enforced at the DB level. */
    noteText: text("note_text").notNull(),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    imageIdIdx: index("photo_viewer_notes_image_id_idx").on(table.imageId),
    createdAtIdx: index("photo_viewer_notes_created_at_idx").on(
      table.datetimeCreated,
    ),
  }),
);
