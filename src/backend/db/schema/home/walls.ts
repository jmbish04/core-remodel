import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { projects } from "./projects";
import { remodelScenarios } from "./remodel_scenarios";
import { rooms } from "./rooms";

/**
 * Walls — the graph the measurement ledger could not hold (0043 §3b).
 *
 * A WALL BELONGS TO THE PROJECT, NOT A ROOM. One wall separates two spaces.
 * Storing it per-room would store it twice and let the two copies disagree —
 * the same denormalisation error the plan bans everywhere else. Which rooms a
 * wall borders is recorded by its face segments below, by FK, not by owning the
 * wall from one side.
 *
 * The existing `measurements` table stays as the as-is dimensional LEDGER. What
 * it could never do is hold a graph: `spanJson` cannot carry a foreign key, so
 * "36 inches from THAT wall" degraded to a string nothing could join. Walls,
 * their face segments, their openings, and ceiling-feature distances are the
 * relational graph that string was standing in for.
 *
 * LOAD-BEARING IS NOT A BOOLEAN. The real distinction is "known to be" vs
 * "confirmed to be" load-bearing, and the difference is whether a homeowner
 * should be quoting it to a contractor. So it carries a confidence and a source
 * reusing the 0041 vocabulary. An `assumed` load-bearing wall is a question, not
 * a fact, and removing one is among the highest-ripple decisions in a remodel.
 */
export const walls = sqliteTable(
  "walls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    /** Human label, e.g. "Kitchen north wall". Optional; the segments carry truth. */
    label: text("label"),

    /** Canonical inches. Feet/metres are computed on read, never stored. */
    lengthInches: integer("length_inches"),
    heightInches: integer("height_inches"),

    /** full | pony | partial_divider | column | knee */
    wallKind: text("wall_kind").notNull().default("full"),

    /** yes | no | unknown — never a bare boolean. */
    loadBearing: text("load_bearing").notNull().default("unknown"),

    /** known | assumed | range | unknown — the 0041 confidence vocabulary. */
    loadBearingConfidence: text("load_bearing_confidence").notNull().default("unknown"),

    /** engineer | contractor | homeowner | drawing | inferred */
    loadBearingSource: text("load_bearing_source"),

    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    projectIdx: index("walls_project_idx").on(table.projectId),
  }),
);

/**
 * Wall face segments — what is on each side of a wall, positioned (0043 §3b).
 *
 * A wall has two sides (a | b). Each side divides into segments along its
 * length, because the far side is not always one thing: the "30/30/30/10 case"
 * — part exterior, part guest bath, part living room, part laundry — is four
 * segments with real positions and real adjacency FKs.
 *
 * POSITIONS ARE INCHES, NOT PERCENTAGES. Percentages were the intuitive framing
 * but they silently rescale the moment the wall is resized: a 30% laundry share
 * quietly becomes a different number of inches with no event recording it.
 * Inches survive a resize; the percentage is derived for display.
 */
export const wallFaceSegments = sqliteTable(
  "wall_face_segments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    wallId: integer("wall_id")
      .notNull()
      .references(() => walls.id, { onDelete: "cascade" }),

    /** a | b — which side of the wall this segment describes. */
    side: text("side").notNull(),

    /** Position along the wall, in inches from its left end. */
    fromInches: integer("from_inches").notNull(),
    toInches: integer("to_inches").notNull(),

    /** room | exterior | garage | crawlspace | unknown */
    adjacentKind: text("adjacent_kind").notNull().default("unknown"),

    /** The room on the other side, when adjacentKind = room. */
    adjacentRoomId: integer("adjacent_room_id").references(() => rooms.id, {
      onDelete: "set null",
    }),

    /** N|E|S|W|NE|NW|SE|SW — which face of the house, when exterior. */
    exteriorCompass: text("exterior_compass"),

    /** street_facing | backyard_facing | left_side | right_side — when exterior. */
    exteriorRelation: text("exterior_relation"),

    /** present | absent | unknown | planned */
    insulationStatus: text("insulation_status").notNull().default("unknown"),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    wallIdx: index("wall_face_segments_wall_idx").on(table.wallId),
    // "which walls border this room" — the adjacency read, both directions.
    adjacentRoomIdx: index("wall_face_segments_adjacent_room_idx").on(table.adjacentRoomId),
  }),
);

/**
 * Wall openings — windows and doors, positioned (0043 §3b).
 *
 * STORE OFFSET + WIDTH, NEVER BOTH SIDES. "Wall length to the left of the window
 * and to the right" is one measurement plus one derivation: the right-hand
 * remainder is `wall.length_inches − offset − width`. Storing both is the
 * feet-and-inches mistake again — two columns holding one fact, disagreeing the
 * first time either is edited.
 */
export const wallOpenings = sqliteTable(
  "wall_openings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    wallId: integer("wall_id")
      .notNull()
      .references(() => walls.id, { onDelete: "cascade" }),

    /** window | exterior_door | interior_door | passage | niche | pass_through */
    openingKind: text("opening_kind").notNull(),

    /** Inches from the wall's left end to the opening's left edge. */
    offsetFromLeftInches: integer("offset_from_left_inches"),
    widthInches: integer("width_inches"),
    heightInches: integer("height_inches"),

    /** Sill height for windows; null for doors. */
    sillHeightInches: integer("sill_height_inches"),

    /** The specified door/window product, once chosen. Never a stored URL. */
    productId: integer("product_id"),

    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    wallIdx: index("wall_openings_wall_idx").on(table.wallId),
  }),
);

/**
 * Wall planned changes — the tense axis for walls (0043 §3b, §4e).
 *
 * A wall has an as-is state (this table's parent) and a to-be state, and the
 * to-be belongs to a SCENARIO — never a flag on `walls` itself. Expressing a
 * removed wall as a scenario-scoped row means it can be proposed, costed, and
 * rolled back without mutating the as-is record of the house. A removed wall is
 * one of the highest-ripple decisions there is, and `change_kind = remove`
 * against an `unknown`-load-bearing wall is exactly the `must_specify` case that
 * blocks pending an engineer.
 */
export const wallPlannedChanges = sqliteTable(
  "wall_planned_changes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    wallId: integer("wall_id")
      .notNull()
      .references(() => walls.id, { onDelete: "cascade" }),

    scenarioId: text("scenario_id")
      .notNull()
      .references(() => remodelScenarios.id, { onDelete: "cascade" }),

    /** keep | resize | reposition | remove | add */
    changeKind: text("change_kind").notNull(),

    notes: text("notes"),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    wallIdx: index("wall_planned_changes_wall_idx").on(table.wallId),
    scenarioIdx: index("wall_planned_changes_scenario_idx").on(table.scenarioId),
  }),
);
