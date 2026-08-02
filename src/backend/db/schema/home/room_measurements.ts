import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { remodelScenarios } from "./remodel_scenarios";
import { rooms } from "./rooms";
import { walls } from "./walls";

/**
 * Room measurements — canonical inches, as-is and proposed (0043 §3).
 *
 * INCHES, INTEGERS, CANONICAL. Feet, metres, and square footage are computed on
 * read, never stored — the same discipline as money's text + cents. A stored
 * `areaSqFt` goes stale silently the first time a wall moves, and nobody
 * notices. The existing `rooms.lengthFeet` / `widthFeet` columns are the mistake
 * this replaces; they are deprecated in place, not dropped.
 *
 * PERIMETER IS MEASURED, NOT DERIVED. `length × width` gives area for a rectangle
 * and nothing useful for anything else — and `rooms.areaSqFt` exists precisely
 * because rooms are not rectangles (the L-shaped lower foyer is 77.28 sq ft).
 * Two rooms of identical area have wildly different perimeters, so paint and
 * baseboard takeoffs are PERIMETER problems. Without `perimeter_inches` those
 * takeoffs are guesses presented as numbers, which is worse than no number.
 *
 * KIND IS THE TENSE AXIS (§4e). `PROPOSED_FLOORPLAN` REQUIRES a `scenario_id`:
 * otherwise "proposed" is ambiguous the moment there are two scenarios, which is
 * exactly the kitchen/living-room swap. Enforced in the service layer, since it
 * is a cross-column rule.
 *
 * CONFIDENCE reuses the 0041 vocabulary. A measurement nobody verified is
 * `assumed`, and `roomReadiness()` already refuses to let `assumed` satisfy the
 * trade threshold. A takeoff computed from it is an estimate, never a quantity
 * to order from.
 */
export const roomMeasurements = sqliteTable(
  "room_measurements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),

    /** EXISTING_FLOORPLAN | PROPOSED_FLOORPLAN */
    kind: text("kind").notNull().default("EXISTING_FLOORPLAN"),

    /** Required when kind = PROPOSED_FLOORPLAN. Which scenario this is the plan for. */
    scenarioId: text("scenario_id").references(() => remodelScenarios.id, {
      onDelete: "cascade",
    }),

    lengthInches: integer("length_inches"),
    widthInches: integer("width_inches"),
    ceilingHeightInches: integer("ceiling_height_inches"),

    /** Measured, not computed. Unlocks paint and baseboard takeoffs. */
    perimeterInches: integer("perimeter_inches"),

    /**
     * A MEASURED area, in square FEET, for a room whose real footprint length ×
     * width cannot describe — an L-shape, a bay, a bump-out. It is NOT a cache of
     * a calculation: for a rectangle, area is `length × width ÷ 144` and is
     * computed ON READ by `takeoff.floorAreaSqFt()`, never stored, because a
     * stored calculation goes stale the instant a measurement changes and turns
     * a one-line formula fix into a find-fix-analyse-backfill saga.
     *
     * So this is null for every rectangular room, and non-null ONLY when a human
     * or a scan measured the actual irregular footprint. That value is a
     * measurement — the same kind of stored fact as `length_inches` — and it
     * wins over the computed rectangle when present.
     *
     * HISTORY: the backfill first copied `rooms.area_sq_ft` here for all rooms,
     * which was wrong — every one of those values equalled length × width, i.e.
     * they were cached rectangles, not measured irregulars. They were nulled.
     * Do not write a computed area into this column; if you are computing it,
     * it belongs in the read path, not the table.
     */
    areaSqFtOverride: real("area_sq_ft_override"),

    /** Floorplan bounding box, percent 0-100, for rendering the room on the plan. */
    bboxXPct: real("bbox_x_pct"),
    bboxYPct: real("bbox_y_pct"),
    bboxWPct: real("bbox_w_pct"),
    bboxHPct: real("bbox_h_pct"),

    /** known | assumed | range | unknown */
    confidence: text("confidence").notNull().default("unknown"),

    measuredBy: text("measured_by"),
    measuredAt: integer("measured_at", { mode: "timestamp" }),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    // "this room's current as-is measurement" — the hottest read.
    roomKindIdx: index("room_measurements_room_kind_idx").on(table.roomId, table.kind),
    scenarioIdx: index("room_measurements_scenario_idx").on(table.scenarioId),
  }),
);

/**
 * Ceiling features — skylights, beams, soffits (0043 §3b).
 *
 * The `spanJson` case done relationally.
 */
export const ceilingFeatures = sqliteTable(
  "ceiling_features",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),

    /** skylight | beam | soffit | vault | coffer | fan_box | light_well */
    featureKind: text("feature_kind").notNull(),

    widthInches: integer("width_inches"),
    lengthInches: integer("length_inches"),

    productId: integer("product_id"),

    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    roomIdx: index("ceiling_features_room_idx").on(table.roomId),
  }),
);

/**
 * Ceiling feature distances — each edge to its nearest wall (0043 §3b).
 *
 * A 4×4 skylight: west edge 126" to the entry wall, north 36" to the shower
 * wall, east 23" to the back wall, south 36" to the vanity wall. Four rows with
 * real `wall_id` FKs — which is what `spanJson` could never carry.
 *
 * And it LOCATES the feature without coordinates: four edge-to-wall distances
 * plus the room's own dimensions place it unambiguously, so an agent can say
 * "the skylight sits in the back third, centred" and be right rather than
 * guessing. That was the point of the original design, and JSON could not
 * deliver it.
 */
export const ceilingFeatureDistances = sqliteTable(
  "ceiling_feature_distances",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    featureId: integer("feature_id")
      .notNull()
      .references(() => ceilingFeatures.id, { onDelete: "cascade" }),

    /** N | E | S | W — which edge of the feature this distance is from. */
    featureEdge: text("feature_edge").notNull(),

    /** The wall this edge is measured to. A real FK, not a spanJson string. */
    wallId: integer("wall_id").references(() => walls.id, { onDelete: "set null" }),

    distanceInches: integer("distance_inches").notNull(),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    featureIdx: index("ceiling_feature_distances_feature_idx").on(table.featureId),
  }),
);

/**
 * Room existing items — the fit-check that pays for itself on SHOPPING (0043 §3b).
 *
 * A homeowner sees an 8-foot interior door in a showroom and adds it to a
 * wishlist. The ceiling in that hallway is 8'0". Nobody catches it until
 * delivery. `keep` items must be accounted for in the to-be plan; `replace`
 * items give the shopping surface a baseline to fit-check a candidate against
 * the actual opening, ceiling, and clearance before it is bought.
 */
export const roomExistingItems = sqliteTable(
  "room_existing_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),

    /** e.g. interior_door, vanity, refrigerator, sofa. */
    itemKind: text("item_kind").notNull(),

    widthInches: integer("width_inches"),
    heightInches: integer("height_inches"),
    depthInches: integer("depth_inches"),

    /** keep | replace | remove | relocate */
    disposition: text("disposition").notNull().default("keep"),

    productId: integer("product_id"),

    notes: text("notes"),

    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    roomIdx: index("room_existing_items_room_idx").on(table.roomId),
  }),
);
