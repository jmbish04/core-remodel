import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * What a room is *used for* (0043 Phase 0). Kitchen, bath, office, bedroom,
 * laundry, mudroom, garage. Admin-managed at `/admin/config/room/uses`.
 *
 * WHY THIS EXISTS: `rooms.asIsUse` and `scenario_room_plans.proposedUse` are
 * both free text today (plan §6.8). That means "kitchen", "Kitchen" and
 * "kitchen " are three different uses, and the use-swap logic — the whole
 * point of which is comparing an as-is use against a proposed one — cannot
 * match them. A vocabulary with a stable `key` makes the comparison an integer
 * equality instead of a string guess.
 *
 * USE IS NOT TYPE. This table answers *what happens in the room*; the parallel
 * `room_type_def` answers *what the room physically is* (wet, dry,
 * circulation, utility). They are different axes and both are needed: a
 * kitchen and a bathroom are different uses that share the "wet" type, which
 * is exactly why a material can be applicable to both without anyone having to
 * enumerate room names. Collapsing the two would force material applicability
 * to be restated per use, and it would drift.
 *
 * USE IS TENSED. A room has an as-is use and, per scenario, a proposed one —
 * the kitchen/living-room swap is the case that matters. This table is only
 * the vocabulary; *which* use applies, and in which tense, stays on `rooms`
 * (as-is) and `scenario_room_plans` (proposed). Those columns are migrated
 * from free text to an FK against this table in a later phase; per §1, the
 * text columns are deprecated in place and never dropped, because a SQLite
 * column drop rebuilds the table and `rooms` has children.
 *
 * NOT a room's name. "Guest Bath" is a name and lives on `rooms.roomName`;
 * `bath` is the use. Two rooms can share a use and never share a name.
 */
export const roomUseDef = sqliteTable("room_use_def", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Stable slug, e.g. "kitchen". This is what code and seeds match on. */
  key: text("key").notNull().unique(),

  /** Display name in plain language, e.g. "Kitchen". */
  name: text("name").notNull(),

  /**
   * What counts as this use, in plain language — PlateJS markdown. The
   * boundaries are genuinely unobvious at the edges: is a wet bar a kitchen, is
   * a powder room a bath? An unexplained vocabulary gets used inconsistently,
   * which returns us to the free-text problem this table exists to end.
   */
  descriptionMarkdown: text("description_markdown"),

  /** Render-ready cache of the same explanation. Sanitized on write. */
  descriptionHtml: text("description_html"),

  /** Flattened text for search and embeddings. */
  descriptionPlaintext: text("description_plaintext"),

  /** Display order in pickers and on the config page. Lowest first. */
  sortOrder: integer("sort_order").notNull().default(0),

  /**
   * Soft-delete. Retiring a use must not rewrite the history of rooms that
   * were once used that way — an as-is record describing a house that no
   * longer exists is still the record of what was there.
   */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type RoomUseDef = typeof roomUseDef.$inferSelect;
export type RoomUseDefInsert = typeof roomUseDef.$inferInsert;
