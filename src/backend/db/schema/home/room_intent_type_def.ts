import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * @fileoverview room_intent_type_def — the vocabulary of what a homeowner
 * intends to do to a room (0043 Phase 0, plan §5a).
 *
 * Every room in the house gets mapped, including the ones nobody is touching,
 * and that friction needs a reason. It has one: the moment the homeowner
 * decides the new hardwood should run continuously, they need square footage
 * for **every** room — and the system cannot ask for it retroactively at the
 * moment it becomes useful. `OUT_OF_SCOPE` is therefore a real, first-class
 * intent, not the absence of one.
 *
 * MANY INTENTS PER ROOM. The drafted "one intent per room" does not survive
 * contact with a real job: replacing a toilet is `TARGETED_FIXTURE` for the
 * fixture, `MEP_CHANGE` for the outlet it drags in, and possibly
 * `SURFACE_REFRESH` for the floor continuity around it. The Phase 3 instance
 * table `room_intents` therefore holds many rows per room, each with its own
 * `intent_type_id` FK to this table.
 *
 * A RIPPLE IS AN IMPACT, NOT A BOOLEAN. The drafted `hasTradeRippleEffect`
 * flag said work exists because of something elsewhere without saying *what*,
 * so it could not be traced, explained or acted on. `room_intents` carries
 * `caused_by_impact_id` into the 0041 graph instead. Do not add a boolean
 * beside a graph that answers more.
 */

/**
 * How much of a room an intent disturbs — the grouping axis that
 * `roomReadiness()` and the scoping UI filter on.
 *
 *  - `OUT_OF_SCOPE`       nothing is being done here; the room is mapped for
 *                         spatial continuity, whole-house material maths and
 *                         ambient context only.
 *  - `CONTIGUOUS_FINISH`  the room is touched only because a finish runs
 *                         through it — flooring continuing down a hallway.
 *  - `TARGETED_UPDATE`    a bounded change: one fixture, one surface, one
 *                         repair, leaving the rest of the room alone.
 *  - `FULL_REMODEL`       the room is being rebuilt.
 *
 * A HARDCODED ENUM ON PURPOSE. Project law says definition tables, never
 * hardcoded enums — **except** where adding a member changes logic rather than
 * just a picker. This is one of those: each level is read by `roomReadiness()`
 * to decide which specs a room must carry, so a fifth level would be a code
 * change whether or not it were also a row. Validated at the API boundary, not
 * by a DB CHECK constraint — same convention as `measurements.elementType`.
 */
export const ROOM_INTENT_SCOPE_LEVELS = [
  "OUT_OF_SCOPE",
  "CONTIGUOUS_FINISH",
  "TARGETED_UPDATE",
  "FULL_REMODEL",
] as const;

/** Union type for an intent type's scope level. */
export type RoomIntentScopeLevel = (typeof ROOM_INTENT_SCOPE_LEVELS)[number];

/**
 * The intent vocabulary. Admin-managed at `/admin/config/room/intent-types`.
 *
 * Seed keys (a seed, not a closed set — a new intent is a row, which is the
 * entire reason `intent_type_id` is an FK rather than an enum column):
 *
 *   OUT_OF_SCOPE          mapped, not touched
 *   TARGETED_FIXTURE      swap one fixture — the Toto case
 *   SURFACE_REFRESH       paint, refinish, re-tile a surface
 *   IN_KIND               replace like for like
 *   REPAIR                fix something broken, no upgrade
 *   WALL_LAYOUT_CHANGE    move, remove or add a wall
 *   CEILING_MODIFICATION  vault, soffit, coffer, drop
 *   FENESTRATION_CHANGE   windows and exterior doors — openings
 *   MOVE_PLUMBING         relocate a drain or supply
 *   MEP_CHANGE            mechanical / electrical / plumbing beyond a move
 *   INFILL                close an opening or absorb adjacent space
 *   HORIZONTAL_ADDITION   extend the footprint outward
 *   VERTICAL_ADDITION     add above
 *   DEMOLITION            remove the space
 */
export const roomIntentTypeDef = sqliteTable("room_intent_type_def", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Stable slug, e.g. "TARGETED_FIXTURE". Seeds and rules match on this. */
  key: text("key").notNull().unique(),

  /** Display name in plain language, e.g. "Replace a fixture". */
  name: text("name").notNull(),

  /**
   * How much of the room this intent disturbs.
   *
   * **SCOPE LEVEL LIVES HERE, ON THE DEFINITION — NEVER ON THE INSTANCE.** An
   * earlier draft carried both a `scopeLevel` and an `intentType` column on
   * the instance, and the two enums overlapped (`OUT_OF_SCOPE`, targeted-update
   * and contiguous-finish appeared in both). Two columns holding one fact
   * eventually disagree, and nothing reconciles them. Derived from the type,
   * it cannot drift, and it still groups and filters exactly as well.
   */
  scopeLevel: text("scope_level", { enum: ROOM_INTENT_SCOPE_LEVELS }).notNull(),

  /**
   * Does `roomReadiness()` demand the full spec set for a room carrying this
   * intent?
   *
   * This column is the fix for a real bug in shipped code: `roomReadiness()`
   * currently requires every `spec_definitions` row flagged
   * `isRequiredForThreshold` on **every** room, globally — so a room nobody is
   * touching sits permanently un-ready, demanding a shower valve and a drywall
   * finish level. The threshold becomes meaningless the day a real house is
   * loaded. Intent has to gate the requirement set, and a room with no intent
   * is not "unready" — it is **not in scope**, which is a different and honest
   * state, the same distinction as `unknown` versus `missing`.
   *
   * False is the safe default: a new intent type demands nothing until someone
   * decides it should. Requiring specs by accident is how the threshold stops
   * being believed.
   */
  requiresFullSpec: integer("requires_full_spec", { mode: "boolean" })
    .notNull()
    .default(false),

  /**
   * What this intent means, in plain language — PlateJS markdown. This is the
   * column that has to teach a first-timer what "in-kind" is, because the word
   * appears on every contractor's estimate and nobody explains it. These are
   * user-facing explanations, not decoration.
   */
  descriptionMarkdown: text("description_markdown"),

  /** Render-ready cache of the same explanation. Sanitized on write. */
  descriptionHtml: text("description_html"),

  /** Flattened text for search and embeddings. */
  descriptionPlaintext: text("description_plaintext"),

  /** Display order in the intent picker and on the config page. Lowest first. */
  sortOrder: integer("sort_order").notNull().default(0),

  /**
   * Soft-delete. Retiring an intent type must not change what a room was said
   * to be in scope for at the time the scope was agreed.
   */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type RoomIntentTypeDef = typeof roomIntentTypeDef.$inferSelect;
export type RoomIntentTypeDefInsert = typeof roomIntentTypeDef.$inferInsert;
