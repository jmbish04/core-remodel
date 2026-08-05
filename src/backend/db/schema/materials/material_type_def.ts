// src/backend/db/schema/materials/material_type_def.ts
import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { roomTypeDef } from "../home/room_type_def";

/**
 * @fileoverview material_type_def — the vocabulary of *kinds* of material, and
 * the room types each kind is limited to (0043 Phase 0, plan §5c).
 *
 * THE TYPE CARRIES THE ENVELOPE; THE APPLICATION CARRIES THE FACT. The flags
 * here describe what a type *can* do — "flooring can span the house" is a
 * property of flooring, and a specific tile SKU inherits it. What actually
 * happened is already recorded by `room_scope_applications` (§5b). Keeping the
 * two apart is what stops one fact living in two places and drifting.
 *
 * This is the vocabulary `material_schedule_items` types against. It is not a
 * product catalogue and not a material instance: no price, no brand, no SKU,
 * no room. Those belong to the material and the product, which reference this.
 */

/**
 * What the stepper must resolve before a material of this type can be applied.
 *
 *  - `room`     resolves to whole rooms — flooring, ceiling work
 *  - `wall`     must name `wall_id`s — "the bathroom's walls" is four
 *               different assemblies and the difference is the entire point
 *  - `surface`  a specific surface (a single wall face, a ceiling, a floor)
 *  - `project`  project-wide, with no room or wall to name
 *
 * LOAD-BEARING, LITERALLY: this tells the UI stepper what to ask next, so
 * adding a material type teaches the stepper how to ask about it for free,
 * instead of requiring a hardcoded switch somewhere in the frontend.
 *
 * Hardcoded enum on purpose — a fifth granularity is a new branch in the
 * stepper, i.e. a code change, not a picker entry. Validated at the API
 * boundary, same convention as `measurements.elementType`.
 */
export const MATERIAL_SCOPE_GRANULARITIES = ["room", "wall", "surface", "project"] as const;

/** Union type for a material type's scope granularity. */
export type MaterialScopeGranularity = (typeof MATERIAL_SCOPE_GRANULARITIES)[number];

/**
 * The unit a takeoff for this type is counted in.
 *
 *  - `sqft`       area — flooring, tile, wall finish
 *  - `linear_ft`  runs — baseboard, trim, countertop edge
 *  - `each`       counted items — doors, outlets, fixtures
 *  - `gallons`    paint and coatings
 *
 * Takeoffs themselves are **computed on read, never stored** (§5c). A stored
 * quantity is wrong the first time a wall moves and nobody notices — the same
 * discipline as measurements in inches and money in cents.
 *
 * Hardcoded enum: each unit has its own arithmetic in the takeoff layer, so a
 * new unit is code.
 */
export const MATERIAL_TAKEOFF_UNITS = ["sqft", "linear_ft", "each", "gallons"] as const;

/** Union type for a material type's takeoff unit. */
export type MaterialTakeoffUnit = (typeof MATERIAL_TAKEOFF_UNITS)[number];

/**
 * Material type vocabulary. Admin-managed at
 * `/admin/config/material/types`. Seeded with FLOORING, WALL_FINISH,
 * INTERIOR_DOOR, WINDOW, LIGHTING, OUTLET, BASEBOARD and the rest — a seed,
 * not a closed set.
 */
export const materialTypeDef = sqliteTable("material_type_def", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Stable slug, e.g. "FLOORING". Rules and seeds match on this, never the id. */
  key: text("key").notNull().unique(),

  /** Display name in plain language, e.g. "Flooring". */
  name: text("name").notNull(),

  /**
   * What this material type covers and where its edges are — PlateJS markdown.
   * Genuinely load-bearing for a first-timer: whether underlayment is part of
   * "flooring" or a line of its own decides whether their budget is missing a
   * number.
   */
  descriptionMarkdown: text("description_markdown"),

  /** Render-ready cache of the same explanation. Sanitized on write. */
  descriptionHtml: text("description_html"),

  /** Flattened text for search and embeddings. */
  descriptionPlaintext: text("description_plaintext"),

  /**
   * CAN a material of this type span an entire floor? Offered by the scope
   * picker; it does not record that anything was applied floor-wide. The
   * application itself fans out to per-room rows and is explained by a
   * `room_scope_applications` row.
   */
  isEntireFloorApplicable: integer("is_entire_floor_applicable", { mode: "boolean" })
    .notNull()
    .default(false),

  /** CAN a material of this type span the whole house? Same rule as above. */
  isEntireHomeApplicable: integer("is_entire_home_applicable", { mode: "boolean" })
    .notNull()
    .default(false),

  /** What the stepper must resolve before this type can be applied. */
  scopeGranularity: text("scope_granularity", { enum: MATERIAL_SCOPE_GRANULARITIES })
    .notNull()
    .default("room"),

  /**
   * The unit this type's takeoff is counted in.
   *
   * NOT NULL and with no default, deliberately: a material type that cannot
   * say how it is counted cannot produce a quantity, and defaulting it would
   * silently hand someone a number in the wrong unit. Making the admin choose
   * is the cheap version of that conversation.
   */
  takeoffUnit: text("takeoff_unit", { enum: MATERIAL_TAKEOFF_UNITS }).notNull(),

  /**
   * Fractional overage a takeoff adds by default — 0.10 for plank flooring,
   * 0.15 for tile on a diagonal lay, 0 for anything counted individually.
   * Overridable per material.
   *
   * Why it is not optional: a takeoff without waste under-orders, and
   * under-ordering tile means a second dye lot, which is not a rounding error
   * but a re-do. Zero is a valid, explicit answer for `each`-counted types —
   * which is why it is the default rather than null.
   */
  defaultWasteFactor: real("default_waste_factor").notNull().default(0),

  /** Display order in material pickers and on the config page. Lowest first. */
  sortOrder: integer("sort_order").notNull().default(0),

  /** Soft-delete — retiring a type keeps existing material rows readable. */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Material type ↔ room type — which room types a material type is limited to.
 *
 * A MAPPING, NOT A COLUMN. The drafted `isRoomTypeUnique` flag plus a single
 * `room_type_id` cannot express the actual domain: a shower valve is unique to
 * bathrooms **and** wet rooms, a range hood to kitchens **and** a butler's
 * pantry. A single-value constraint on a genuinely many-valued relationship is
 * the same error the plan corrected three times elsewhere, so it is corrected
 * here up front rather than after it ships.
 *
 * **ZERO ROWS MEANS UNRESTRICTED, NOT UNAVAILABLE.** Paint applies everywhere
 * and must not need a row per room type to say so. Only a type with at least
 * one mapping is limited, and it is limited to exactly the types it maps to.
 * Any query that reads this must encode that rule, because the opposite
 * reading — no rows, therefore nothing applies — makes every unmapped material
 * silently vanish from every room.
 *
 * The unique index makes re-applying a mapping idempotent, so an
 * `onConflictDoNothing` writer can run twice without doubling up.
 */
export const materialTypeRoomTypeMapping = sqliteTable(
  "material_type_room_type_mapping",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    materialTypeId: integer("material_type_id")
      .notNull()
      .references(() => materialTypeDef.id, { onDelete: "cascade" }),

    roomTypeId: integer("room_type_id")
      .notNull()
      .references(() => roomTypeDef.id, { onDelete: "cascade" }),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    materialTypeRoomTypeUniq: uniqueIndex(
      "material_type_room_type_mapping_material_room_uniq"
    ).on(table.materialTypeId, table.roomTypeId),
  })
);

export type MaterialTypeDef = typeof materialTypeDef.$inferSelect;
export type MaterialTypeDefInsert = typeof materialTypeDef.$inferInsert;
export type MaterialTypeRoomTypeMapping = typeof materialTypeRoomTypeMapping.$inferSelect;
export type MaterialTypeRoomTypeMappingInsert =
  typeof materialTypeRoomTypeMapping.$inferInsert;
