import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { remodelScenarios } from "./remodel_scenarios";

/**
 * Surfaces: assemblies, fixtures, requirements (0043 §3d).
 *
 * Eight would-be subsystems — wall tech, ceiling tech, lighting, window
 * coverings, finishes, blocking, in-wall utilities, acoustics — decompose into
 * THREE primitives. Eight bespoke schemas would drift; this is the small shape
 * underneath them all:
 *
 *   ASSEMBLY     an ordered stack of layers on a surface
 *   FIXTURE      a thing attached to a surface at a position
 *   REQUIREMENT  what a fixture demands of the assembly
 *
 * `surface_kind` + `surface_id` is a loose pair, not seven nullable FKs: a
 * surface is a wall face, a ceiling, or a floor, and a column per kind would be
 * almost always null. The service layer resolves the pair; nothing writes one
 * half without the other.
 */

/**
 * A finish build-up on one surface, scoped to a scenario (tense axis).
 *
 * Every finish is a stack: a party wall is studs → mineral wool → MLV → 5/8"
 * Type X → Green Glue → 5/8" Type X → Level 5 → primer → paint; a shower wall is
 * framing → cement board → waterproofing → thinset → tile → grout. Same shape.
 * Drywall level, thickness, insulation, MLV, uncoupling, waterproofing all
 * become LAYERS, not columns, so a new technique is a row not a migration.
 */
export const surfaceAssemblies = sqliteTable(
  "surface_assemblies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** wall_face | ceiling | floor */
    surfaceKind: text("surface_kind").notNull(),
    /** Id within surfaceKind — a wall-face segment id, a room id for ceiling/floor. */
    surfaceId: integer("surface_id").notNull(),

    /** The scenario this build-up belongs to. As-is vs to-be. */
    scenarioId: text("scenario_id").references(() => remodelScenarios.id, {
      onDelete: "cascade",
    }),

    label: text("label"),

    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    surfaceIdx: index("surface_assemblies_surface_idx").on(table.surfaceKind, table.surfaceId),
  }),
);

/**
 * The kinds of layer an assembly can stack. A definition table — a new material
 * technique is a row, the same principle as `impact_definitions`.
 *
 * `takeoff_unit` and `default_waste_factor` live here so a layer produces its
 * own quantity: layer area × the surface area × waste, straight into the budget.
 */
export const assemblyLayerKindDef = sqliteTable("assembly_layer_kind_def", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** stud | insulation | mlv | drywall | membrane | uncoupling | thinset | finish | ... */
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  descriptionMarkdown: text("description_markdown"),
  descriptionHtml: text("description_html"),
  descriptionPlaintext: text("description_plaintext"),
  /** sqft | linear_ft | each | gallons */
  takeoffUnit: text("takeoff_unit").notNull().default("sqft"),
  defaultWasteFactor: real("default_waste_factor").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** One ordered layer in an assembly. `position` lowest = innermost/first. */
export const assemblyLayers = sqliteTable(
  "assembly_layers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assemblyId: integer("assembly_id")
      .notNull()
      .references(() => surfaceAssemblies.id, { onDelete: "cascade" }),
    layerKindId: integer("layer_kind_id")
      .notNull()
      .references(() => assemblyLayerKindDef.id, { onDelete: "restrict" }),
    position: integer("position").notNull().default(0),
    /** The specified product for this layer, when chosen. */
    productId: integer("product_id"),
    thicknessInches: real("thickness_inches"),
    /** Layer-specific parameters that are not worth a column (e.g. finish level). */
    specJson: text("spec_json"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    assemblyIdx: index("assembly_layers_assembly_idx").on(table.assemblyId, table.position),
  }),
);

/**
 * The kinds of fixture that attach to a surface. A definition table.
 * TV mount, floating vanity, rainfall head, medicine cabinet, sconce, faceplate,
 * curtain track, in-wall safe, laundry chute.
 */
export const fixtureTypeDef = sqliteTable("fixture_type_def", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  descriptionMarkdown: text("description_markdown"),
  descriptionHtml: text("description_html"),
  descriptionPlaintext: text("description_plaintext"),
  /** JSON array of surface_kinds this fixture can attach to. */
  appliesToSurfaceKinds: text("applies_to_surface_kinds"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** A fixture attached to a surface at a position, scoped to a scenario. */
export const surfaceFixtures = sqliteTable(
  "surface_fixtures",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    surfaceKind: text("surface_kind").notNull(),
    surfaceId: integer("surface_id").notNull(),
    fixtureTypeId: integer("fixture_type_id")
      .notNull()
      .references(() => fixtureTypeDef.id, { onDelete: "restrict" }),
    /** Position on the surface, inches from its origin. */
    offsetXInches: integer("offset_x_inches"),
    offsetYInches: integer("offset_y_inches"),
    productId: integer("product_id"),
    scenarioId: text("scenario_id").references(() => remodelScenarios.id, {
      onDelete: "cascade",
    }),
    notes: text("notes"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    surfaceIdx: index("surface_fixtures_surface_idx").on(table.surfaceKind, table.surfaceId),
    typeIdx: index("surface_fixtures_type_idx").on(table.fixtureTypeId),
  }),
);

/**
 * What a fixture type demands of the assembly it attaches to (0043 §3d).
 *
 * This is the layer that makes the whole thing worth building, and it is where
 * the prompted questions ("will a TV be wall-mounted?") turn into consequences.
 *
 * `blocks_assembly_close` is the highest-value column: a requirement that must
 * be satisfied BEFORE a wall or ceiling closes is a hard sequencing constraint,
 * and missing it is the single most expensive category of remodel mistake —
 * opening a finished, painted wall because nobody blocked for the TV.
 */
export const fixtureRequirements = sqliteTable(
  "fixture_requirements",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fixtureTypeId: integer("fixture_type_id")
      .notNull()
      .references(() => fixtureTypeDef.id, { onDelete: "cascade" }),
    /** blocking | electrical | plumbing | reinforcement | clearance | finish_coord */
    requirementKind: text("requirement_kind").notNull(),
    spec: text("spec"),
    /** Must this be met before the wall/ceiling closes? The sequencing flag. */
    blocksAssemblyClose: integer("blocks_assembly_close", { mode: "boolean" })
      .notNull()
      .default(false),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    fixtureIdx: index("fixture_requirements_fixture_idx").on(table.fixtureTypeId),
  }),
);

