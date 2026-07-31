import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * The vocabulary of things a room can specify (0041 Phase 0).
 *
 * A definition table, per project law: spec fields are a growing vocabulary
 * ("drywall finish level", "shower valve", "reveal tolerance"), never a hardcoded
 * enum and never a JSON blob. Adding a new spec kind is a row, not a migration.
 *
 * `isRequiredForThreshold` is the load-bearing column. It is what
 * `roomReadiness(roomId)` reads to decide whether a room may present itself to
 * the trade. A room cannot cross the translation-ready threshold while any
 * definition flagged required has a null or unverified value on that room.
 *
 * That check is data, not self-assessment — which is the entire point. A
 * homeowner who *feels* ready and a homeowner who *is* ready are different
 * people, and only one of them should be in the room with a contractor.
 *
 * `appliesToRoomKinds` narrows a definition to the rooms where it means
 * something (a shower valve is not a kitchen question). Null = applies to all.
 * Stored as a JSON array of room-kind slugs; this is a scoping hint for the UI,
 * NOT a multi-select of user data, so it does not warrant a mapping table.
 */
export const specDefinitions = sqliteTable("spec_definitions", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Stable slug, e.g. "drywall_finish_level". */
  key: text("key").notNull().unique(),

  /** Display name shown to the homeowner, in plain language. */
  name: text("name").notNull(),

  /**
   * What this is and why it matters, in plain language. Surfaced next to the
   * field — every professional term appears with its translation, which is an
   * accessibility requirement here and not a courtesy.
   */
  description: text("description"),

  /**
   * How the value is captured and validated:
   *   product   — FK to products (a real purchasable thing)
   *   material  — FK to materials
   *   choice    — one of a fixed option set carried on this definition
   *   text      — freeform
   *   money     — text + cents pair
   *   dimension — measurement
   */
  valueKind: text("value_kind").notNull().default("text"),

  /** JSON array of allowed options when valueKind = "choice". */
  choiceOptions: text("choice_options"),

  /**
   * Gates the translation-ready threshold. See `roomReadiness()` — this is the
   * only thing that decides whether a missing field blocks the trade handoff.
   */
  isRequiredForThreshold: integer("is_required_for_threshold", { mode: "boolean" })
    .notNull()
    .default(false),

  /** JSON array of room-kind slugs this applies to. Null = all rooms. */
  appliesToRoomKinds: text("applies_to_room_kinds"),

  /** Display order within a room's spec list. */
  sortOrder: integer("sort_order").notNull().default(0),

  /** Soft-delete — a retired spec kind keeps its historical values readable. */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
