import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { roomNoteTypeDef } from "./room_note_type_def";
import { rooms } from "./rooms";

/**
 * Room notes — authored notes on a room, typed (0043 §2, §4).
 *
 * THE MAPPING JOINS NOTE↔TYPE, NOT ROOM↔TYPE. The drafted schema mapped a ROOM
 * to a type and left `room_notes` with no `room_id` at all. That is backwards:
 * the stated goal — "notes that have multiple type involvements, when trades
 * collaborate on an issue that impacts all of them" — is a property of a NOTE. A
 * room "having" a plumbing type means nothing; a single note being BOTH plumbing
 * and structural is the case that matters, and it is the join below.
 *
 * So the note owns its room, and its types come from `room_note_type_mapping`.
 *
 * THREE FORMATS, ALWAYS. Markdown is the portable source of truth, HTML is the
 * render-ready cache, plaintext is what search and embeddings consume. Notes are
 * captured with PlateJS, which emits all three — never a bare `<textarea>`, and
 * never only one of the three.
 *
 * These replace the six free-text `*Notes` columns on `rooms` (plumbingNotes,
 * electricalNotes, structuralNotes, hvacNotes, generalNotes, problemAreas),
 * which allowed only one note per concern per room. Those columns are backfilled
 * into typed notes and deprecated in place — never dropped, per §1.
 */
export const roomNotes = sqliteTable(
  "room_notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),

    /** Portable source of truth. */
    noteMarkdown: text("note_markdown"),
    /** Render-ready cache. Sanitized on write. */
    noteHtml: text("note_html"),
    /** Flattened text for search and embeddings. */
    notePlaintext: text("note_plaintext"),

    /** Who wrote it — a household member, an agent label, or a contractor. */
    author: text("author"),

    /** Soft-delete — a removed note stays in the record. */
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    roomIdx: index("room_notes_room_idx").on(table.roomId),
  }),
);

/**
 * Room note ↔ type — a note's involvements (0043 §2).
 *
 * Joins `room_notes` to `room_note_type_def`. A note can carry several types —
 * plumbing AND structural for a collaboration issue — which is the entire reason
 * the mapping is on the note rather than a single type column.
 *
 * The unique index makes re-tagging idempotent, so an `onConflictDoNothing`
 * writer never doubles a (note, type) pair.
 */
export const roomNoteTypeMapping = sqliteTable(
  "room_note_type_mapping",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    roomNoteId: integer("room_note_id")
      .notNull()
      .references(() => roomNotes.id, { onDelete: "cascade" }),

    roomNoteTypeId: integer("room_note_type_id")
      .notNull()
      .references(() => roomNoteTypeDef.id, { onDelete: "cascade" }),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    noteTypeUniq: uniqueIndex("room_note_type_mapping_note_type_uniq").on(
      table.roomNoteId,
      table.roomNoteTypeId,
    ),
    typeIdx: index("room_note_type_mapping_type_idx").on(table.roomNoteTypeId),
  }),
);
