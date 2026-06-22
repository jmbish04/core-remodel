import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { floors } from "./floors";

/**
 * Master room records for the home as-is footprint.
 *
 * C1 (0005 REVISIONS): rooms are never hard-deleted.  When a drift/ghost room is
 * merged into a canonical room, all FK references are repointed to the canonical
 * room first, then the merged room is soft-deleted by setting is_active = false.
 * Invariant: an is_active=false room must have ZERO images (listing or inspiration)
 * on it after the merge.
 *
 * All room listings (catalog, floorplan, sidebar, pickers) filter WHERE is_active = 1.
 */
export const rooms = sqliteTable("rooms", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  floorId: integer("floor_id")
    .notNull()
    .references(() => floors.id, { onDelete: "cascade" }),
  roomCode: text("room_code").notNull().unique(), // stable identifier (slug)
  roomName: text("room_name").notNull(), // display name
  asIsUse: text("as_is_use"), // current usage label

  // Structured dimension fields, e.g. 15'0" x 24'10"
  lengthFeet: integer("length_feet"),
  lengthInches: integer("length_inches"),
  widthFeet: integer("width_feet"),
  widthInches: integer("width_inches"),

  /**
   * Explicit square-footage override (0006 PHASE 1).
   *
   * When set (non-null), this authoritative area is PREFERRED over the
   * length × width computation in home-catalog.ts `computeRoomSqft`, so irregular
   * / non-rectangular rooms (e.g. the L-shaped lower foyer = 77.28 sq ft) report
   * their true area everywhere the catalog `sqft` field is surfaced (floor-plan
   * hover card, room detail, bid portfolios).  null = fall back to the computed
   * rectangular estimate.
   */
  areaSqFt: real("area_sq_ft"),

  isLivingSpace: integer("is_living_space", { mode: "boolean" }).notNull().default(true),

  /**
   * Soft-delete flag (C1 — 0005 REVISIONS).
   *
   * true  = canonical active room; shown in all listings, catalogs, and pickers.
   * false = merged / deactivated room; kept for audit trail.
   *         Must carry ZERO images (listing or inspiration) before being set false.
   *
   * Default true: every freshly-inserted room is active.
   */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  // Known room details for renovation planning.
  problemAreas: text("problem_areas"), // JSON array or freeform
  plumbingNotes: text("plumbing_notes"),
  electricalNotes: text("electrical_notes"),
  structuralNotes: text("structural_notes"),
  hvacNotes: text("hvac_notes"),
  generalNotes: text("general_notes"),
  metadata: text("metadata"), // JSON

  /**
   * Floorplan coordinate columns (Phase 0 — 0005_room_floorplan_overview_room_viewport).
   *
   * The floor-plan page renders one dot per room using these values instead of the
   * previously hardcoded ROOM_COORDINATES_BY_CODE object in the frontend.  Rooms with
   * null x/y are still shown but appear in an "Outside / Unplaced" sidebar group with
   * no dot on the SVG canvas.
   *
   * floorplanFloorKey — matches floors.key: "lower_level" | "upper_level" | "outside" | null.
   *   A null key means the room has not been assigned to any floorplan canvas yet.
   *
   * floorplanXPct — horizontal position on the floorplan image, 0–100 (percent).
   *   0 = left edge, 100 = right edge.  null = no dot (sidebar only).
   *
   * floorplanYPct — vertical position on the floorplan image, 0–100 (percent).
   *   0 = top edge (back of house / bedrooms), 100 = bottom edge (street / kitchen).
   *   null = no dot (sidebar only).
   *
   * Both x/y must be non-null for a dot to render.  Setting either to null collapses
   * the room into the "Unplaced" group.  Use setFloorplanPosition(code, {null, null})
   * to remove a dot while keeping the floor-key assignment for grouping purposes.
   */
  floorplanFloorKey: text("floorplan_floor_key"), // "lower_level" | "upper_level" | "outside" | null
  floorplanXPct: real("floorplan_x_pct"), // 0–100, null = no dot
  floorplanYPct: real("floorplan_y_pct"), // 0–100, null = no dot

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
