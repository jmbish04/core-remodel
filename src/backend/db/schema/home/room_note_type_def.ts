import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The vocabulary of trades / concerns a room note can be about (0043 Phase 0).
 *
 * Seeded: Plumbing, Electrical, Structural, HVAC. That list is a seed, not a
 * closed set — a definition table exists precisely so "Roofing" or "Low
 * voltage" is a row an admin adds at `/admin/config/room/note-types`, never a
 * migration.
 *
 * WHAT THIS TYPES: **a note, not a room.** The plan (§2) corrected an earlier
 * draft that mapped `room_id ↔ room_note_type_id`. A room "having" a plumbing
 * type says nothing useful; the case that matters is a single note that is
 * *both* plumbing and structural — the note you write when the trades have to
 * collaborate on one issue. So the mapping table that arrives in Phase 2 joins
 * `room_note_id ↔ room_note_type_id`, and `room_notes` carries the `room_id`.
 *
 * WHAT IT IS NOT:
 *  - Not the note body. The three-format note text (markdown / html /
 *    plaintext, per PlateJS) lives on `room_notes`, one row per note.
 *  - Not a replacement for the six `*Notes` columns on `rooms` by itself.
 *    Those are backfilled into typed `room_notes` rows in Phase 2 and then
 *    deprecated **in place** — nothing is dropped from `rooms`, because a
 *    SQLite column drop rebuilds the table and `rooms` has children (§1).
 *  - Not severity or priority. A note is not a problem; problems are
 *    `room_problems`, which carry their own lifecycle and safety flag.
 *
 * The three `description_*` columns are the plain-language explanation shown
 * beside the type in the picker. They are not decoration: a first-time
 * remodeler does not know which of their concerns counts as "Structural", and
 * a vocabulary nobody can map their own words onto gets used wrong or not at
 * all.
 */
export const roomNoteTypeDef = sqliteTable("room_note_type_def", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Stable slug, e.g. "plumbing". Seeds and code reference this, never the id. */
  key: text("key").notNull().unique(),

  /** Display name in plain language, e.g. "Plumbing". */
  name: text("name").notNull(),

  /** Portable source of truth for the explanation — PlateJS markdown. */
  descriptionMarkdown: text("description_markdown"),

  /** Render-ready cache of the same explanation. Sanitized on write. */
  descriptionHtml: text("description_html"),

  /** Flattened text for search and embeddings. */
  descriptionPlaintext: text("description_plaintext"),

  /** Display order in the type picker and on the config page. Lowest first. */
  sortOrder: integer("sort_order").notNull().default(0),

  /**
   * Soft-delete. A retired type must stay readable, because notes already
   * tagged with it keep their meaning; hard-deleting the row would silently
   * untype historical notes. Listings filter `is_active = 1`.
   */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type RoomNoteTypeDef = typeof roomNoteTypeDef.$inferSelect;
export type RoomNoteTypeDefInsert = typeof roomNoteTypeDef.$inferInsert;
