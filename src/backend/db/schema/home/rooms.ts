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

  /**
   * Floorplan region bounding box (0005 → 0014 workshop) — the room's rectangle
   * on the floorplan image, in percent (0–100). Set via /admin/designs/floorplan-
   * regions. When present, the Workshop crops the floorplan to this region and
   * furnish-this-plan runs per-room instead of whole-house.
   */
  floorplanBboxXPct: real("floorplan_bbox_x_pct"),
  floorplanBboxYPct: real("floorplan_bbox_y_pct"),
  floorplanBboxWPct: real("floorplan_bbox_w_pct"),
  floorplanBboxHPct: real("floorplan_bbox_h_pct"),
  /** Cloudflare Images token of the cropped per-room floorplan region (if cropped). */
  floorplanCropCfImageId: text("floorplan_crop_cf_image_id"),

  /**
   * Permanent line identity (0041 Phase 0 — the Diagram).
   *
   * `lineColorHex` is the room's colour for the life of the project. It is
   * assigned once at creation and then carried EVERYWHERE the room is ever
   * referenced — budget rows, photo groups, receipts, bids, notifications, the
   * in-car screen. It is functional identity, not styling, and it is never
   * re-themed per page.
   *
   * The set must stay mutually distinguishable at arm's length across ~20
   * simultaneous rooms, and must survive both the dark and light ground (see
   * DESIGN.md, "The Both Grounds Rule"). Null = not yet assigned; the UI falls
   * back to a neutral line rather than picking a colour at render time, because
   * a colour that changes between page loads is not identity.
   *
   * `lineOrder` is the room's draw order in the diagram, lowest first. Null
   * sorts last. Kept separate from any display sort so that reordering the
   * diagram never reorders a picker.
   */
  lineColorHex: text("line_color_hex"),
  lineOrder: integer("line_order"),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
