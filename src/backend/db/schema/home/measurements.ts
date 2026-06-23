import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { floors } from "./floors";
import { rooms } from "./rooms";

/**
 * @fileoverview measurements — master, as-is dimensional record for the whole house.
 *
 * 0006 PHASE 1.  This is the single source of truth for every physical dimension
 * in and around the home: rooms, closets, windows, doors, fixtures, walls, stairs,
 * skylights, outdoor structures, duct / mechanical runs, and appliances.
 *
 * Design notes
 * ------------
 *  - **As-is only.**  A `measurements` row captures reality, not a proposed change.
 *    Proposed changes (scope items) and their deltas arrive in 0006 Phase 2 and
 *    reference these rows; they are NOT modelled here.
 *  - **Room / floor are optional.**  Many measurements belong to a room
 *    (`room_id` → rooms) and/or a floor (`floor_id` → floors), but house-wide or
 *    site measurements (e.g. a backyard retaining wall) may have neither.  Both FKs
 *    use `onDelete: "set null"` — rooms are soft-deleted (never hard-deleted, see
 *    rooms.ts C1), so in practice this never fires, but it keeps the row valid if a
 *    floor or room is ever physically removed.
 *  - **Dimensions are stored feet + inches**, mirroring the `rooms` table's
 *    `lengthFeet`/`lengthInches` convention so the two tables read identically.
 *    Feet are whole numbers (`integer`); inches are `real` so the master record can
 *    carry fractional inches (e.g. 10.5") that tape / Matterport measurements yield.
 *    Every dimension column is nullable — a measurement may record only the
 *    dimensions that are relevant to it (a window has width/height; a floor area
 *    may record only `areaSqFt`).
 *  - **`spanJson`** holds named spans that don't fit length/width/height — e.g. a
 *    skylight's distance from each of the four surrounding walls.  Stored as a JSON
 *    string (this repo's convention is plain `text` JSON columns parsed at the edge).
 *  - **`areaSqFt`** is an explicit, authoritative area (e.g. an irregular / L-shaped
 *    footprint) that should be trusted over any length×width computation.
 *  - **`source` + `isApproximate` + `accuracyNote`** record provenance and
 *    confidence so downstream ROI / decision math (Phase 2+) can weight numbers.
 *    Insurance / Matterport extracts are approximate by default; a re-measured value
 *    can be flagged exact.
 *
 * Enum columns (`elementType`, `source`) are plain SQLite `text` columns with a
 * Drizzle `enum` type annotation — this gives compile-time safety and a single
 * source of truth for the allowed values (re-used by the Zod request schemas in
 * the API layer) without emitting a DB CHECK constraint.  This matches the repo's
 * pattern of validating enums at the API boundary rather than in the database.
 */

/**
 * Allowed `element_type` values — the kind of thing a measurement describes.
 * Re-exported and consumed by the API layer's Zod schema so the DB and the
 * request validation never drift.
 */
export const MEASUREMENT_ELEMENT_TYPES = [
  "room",
  "closet",
  "built_in",
  "window",
  "door",
  "shower",
  "tub",
  "vanity",
  "sink",
  "toilet",
  "wall",
  "ceiling",
  "clearance",
  "stair",
  "stair_landing",
  "pony_wall",
  "handrail",
  "skylight",
  "roof",
  "post",
  "retaining_wall",
  "appliance",
  "duct",
  "mechanical_run",
  "site_area",
  "other",
] as const;

/** Union type for a measurement's element type. */
export type MeasurementElementType = (typeof MEASUREMENT_ELEMENT_TYPES)[number];

/**
 * Allowed `source` values — where the number came from, which implies its trust level.
 *  - insurance_matterport — pulled from the insurance Matterport scan (approximate)
 *  - measured             — physically tape-measured on site (authoritative)
 *  - estimated            — owner / agent estimate (approximate)
 *  - plan                 — taken off an architectural / construction plan
 */
export const MEASUREMENT_SOURCES = [
  "insurance_matterport",
  "measured",
  "estimated",
  "plan",
] as const;

/** Union type for a measurement's source. */
export type MeasurementSource = (typeof MEASUREMENT_SOURCES)[number];

/**
 * Master measurements table (as-is reality).  See file header for full rationale.
 */
export const measurements = sqliteTable(
  "measurements",
  {
    /** Surrogate primary key (matches the rooms / floors integer-id family). */
    id: integer("id").primaryKey({ autoIncrement: true }),

    /**
     * Optional owning room (FK → rooms.id).  null = house-wide / site measurement
     * not tied to a single room.  Only ACTIVE rooms are valid targets; the API
     * enforces `rooms.is_active = true` on write.
     */
    roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),

    /**
     * Optional floor (FK → floors.id).  Useful for floor-scoped elements
     * (e.g. an upstairs hallway clearance) that aren't bound to one room.
     */
    floorId: integer("floor_id").references(() => floors.id, { onDelete: "set null" }),

    /** What kind of element this measurement describes. */
    elementType: text("element_type", { enum: MEASUREMENT_ELEMENT_TYPES }).notNull(),

    /** Human label, e.g. "Living-room fireplace footprint". Optional — falls back to elementType in the UI. */
    label: text("label"),

    // ── Dimensions (feet + inches) — mirrors rooms.ts; feet integer, inches real ──
    /** Length — whole feet. */
    lengthFeet: integer("length_feet"),
    /** Length — inches (real, allows fractions such as 10.5"). */
    lengthInches: real("length_inches"),
    /** Width — whole feet. */
    widthFeet: integer("width_feet"),
    /** Width — inches (real). */
    widthInches: real("width_inches"),
    /** Height — whole feet. */
    heightFeet: integer("height_feet"),
    /** Height — inches (real). */
    heightInches: real("height_inches"),

    /**
     * Named spans that don't fit length/width/height, as a JSON string.
     * Example (skylight): {"fromNorthWall":{"feet":2,"inches":6},"fromEastWall":{...}}.
     */
    spanJson: text("span_json"),

    /**
     * Explicit, authoritative area in square feet (e.g. an irregular / L-shaped
     * footprint).  When present this is the trusted area and should be preferred
     * over any length × width computation.
     */
    areaSqFt: real("area_sq_ft"),

    /** How many identical elements this row represents (e.g. 8 stair treads). Defaults to 1. */
    quantity: integer("quantity").notNull().default(1),

    /** Provenance of the number (implies trust level). */
    source: text("source", { enum: MEASUREMENT_SOURCES }).notNull().default("estimated"),

    /**
     * Whether the value is approximate.  Defaults to true (conservative — surfaces
     * uncertainty rather than hiding it); flip to false for re-measured values.
     */
    isApproximate: integer("is_approximate", { mode: "boolean" }).notNull().default(true),

    /** Free-text caveat about accuracy, e.g. "Matterport, ±3in". */
    accuracyNote: text("accuracy_note"),

    /** Free-text notes. */
    notes: text("notes"),

    /** Arbitrary structured extras, JSON string. */
    metadata: text("metadata"),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql("(unixepoch() * 1000)")),
    datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
      .notNull()
      .default(sql("(unixepoch() * 1000)")),
  },
  (table) => ({
    // List/filter endpoints query primarily by room, then by floor and element type.
    roomIdIdx: index("measurements_room_id_idx").on(table.roomId),
    floorIdIdx: index("measurements_floor_id_idx").on(table.floorId),
    elementTypeIdx: index("measurements_element_type_idx").on(table.elementType),
  }),
);
