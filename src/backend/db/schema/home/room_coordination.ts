import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { businessTypes } from "../directory/business_types";
import { companies } from "../directory/companies";
import { permitsRecords } from "./permits_records";
import { rooms } from "./rooms";

/**
 * Room coordination: trade assignments, permit mapping, the event timeline
 * (0043 §6).
 */

/**
 * Which contractor is responsible for which room's scope, and for what trade.
 *
 * Answers "who do I call about this", and it is what 0042's replacement-handoff
 * package needs to state what a replacement is inheriting. `trade_type_id`
 * reuses the existing `business_types` vocabulary rather than minting a parallel
 * trade taxonomy.
 *
 * A room can carry several assignments — a bathroom has a plumber AND an
 * electrician AND a tile setter — so this is a mapping, unique per
 * (room, company, trade).
 */
export const roomTradeAssignments = sqliteTable(
  "room_trade_assignments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),

    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),

    /** The trade — reuses the business_types vocabulary. */
    tradeTypeId: integer("trade_type_id").references(() => businessTypes.id, {
      onDelete: "set null",
    }),

    /** What this company is responsible for in this room. */
    scopeNotesMarkdown: text("scope_notes_markdown"),
    scopeNotesHtml: text("scope_notes_html"),
    scopeNotesPlaintext: text("scope_notes_plaintext"),

    /** proposed | active | completed | released */
    status: text("status").notNull().default("proposed"),

    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    roomIdx: index("room_trade_assignments_room_idx").on(table.roomId),
    companyIdx: index("room_trade_assignments_company_idx").on(table.companyId),
    uniq: uniqueIndex("room_trade_assignments_room_company_trade_uniq").on(
      table.roomId,
      table.companyId,
      table.tradeTypeId,
    ),
  }),
);

/**
 * Permit ↔ room (0043 §6).
 *
 * `permits_records` is property-scoped, but a permit usually covers SPECIFIC
 * rooms, and the ripple rules already assume permit-affects-room. Without this
 * mapping, "does this change affect the permit" cannot be answered per room.
 * One permit covers several rooms; one room may be under several permits —
 * hence a mapping. `permits_records.id` is a UUID text column, so the FK is text.
 */
export const roomPermitMapping = sqliteTable(
  "room_permit_mapping",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),

    permitId: text("permit_id")
      .notNull()
      .references(() => permitsRecords.id, { onDelete: "cascade" }),

    /** What of this permit's scope lands in this room. */
    scopeNotes: text("scope_notes"),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    roomIdx: index("room_permit_mapping_room_idx").on(table.roomId),
    permitIdx: index("room_permit_mapping_permit_idx").on(table.permitId),
    uniq: uniqueIndex("room_permit_mapping_room_permit_uniq").on(table.roomId, table.permitId),
  }),
);

/**
 * Room events — one append-only stream per room (0043 §6).
 *
 * Stop changes, notes, problems, photos, purchases, visits, measurements — so
 * the room screen reads its history without seven joins, and as the substrate
 * for 0041's traversable history. Append-only: an event is a fact that happened,
 * never edited.
 *
 * `subject_kind` + `subject_id` point at the thing the event is about, a loose
 * pair like `impact_targets` — the timeline is heterogeneous by nature and a
 * column per kind would be almost always null.
 */
export const roomEvents = sqliteTable(
  "room_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),

    /**
     * stop_change | note_added | problem_opened | problem_resolved |
     * photo_added | material_purchased | visit_logged | measurement_recorded |
     * intent_changed | ...
     */
    eventKind: text("event_kind").notNull(),

    /** What the event is about. */
    subjectKind: text("subject_kind"),
    subjectId: integer("subject_id"),

    /** A short human summary for the timeline row. */
    summary: text("summary"),

    /** Who or what produced the event. */
    actor: text("actor"),

    /** When it actually happened (may differ from when it was recorded). */
    occurredAt: integer("occurred_at", { mode: "timestamp" }),

    /** Immutable — the record of when this landed. */
    recordedAt: integer("recorded_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    // "this room's timeline, newest first" — the read the room screen makes.
    roomOccurredIdx: index("room_events_room_occurred_idx").on(table.roomId, table.occurredAt),
    subjectIdx: index("room_events_subject_idx").on(table.subjectKind, table.subjectId),
  }),
);
