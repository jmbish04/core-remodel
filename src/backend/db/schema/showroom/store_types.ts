import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Showroom Store Types — the BUSINESS-MODEL axis for a store.
 *
 * Orthogonal to `showroom_store_category` (what a store SELLS — Tile, Windows,
 * Plumbing…, many-to-many). Type is how the business OPERATES, and a store is
 * exactly ONE of them, so `showroom_stores.type_id` is a single FK to this
 * table (no mapping table).
 *
 * This is the config-driven definition pattern (AGENTS.md "Multi-select &
 * config-driven definitions"): rows are managed at /admin/config, never a hard
 * drizzle enum — a new type is a row insert, not a schema migration. `is_active`
 * soft-retires a type without breaking stores that still point at it.
 *
 * Seed vocabulary (key — displayName) — derived from the live 219-store corpus
 * (2026-07-25), not guessed. Example vendors are real rows.
 *   corporate              — Brand/manufacturer-owned showroom (Daltile, Pella)
 *   authorized_dealer      — Independent dealer of premium brand(s) (Lema, Poliform)
 *   local_boutique         — Independent curated boutique (Splashworks, DJ Bath)
 *   big_box_retail         — Mass retail, buy off the floor (IKEA, Container Store)
 *   distributor            — Distribution / trade supply, sample area, sells onward
 *                            or online (Duraamen, Archatrak)
 *   manufacturer_factory   — Makes it themselves; factory + showroom/consult
 *                            (Concreteworks, Closet Factory)
 *   specialty_applied_finish — Coatings / microcement / plaster / decorative-concrete
 *                            applicator (Topcret, Craftex, Tile Tech Pavers)
 *   specialty_no_showroom  — Trade / field specialist, no walk-in premises; call,
 *                            appointment, or samples by mail (Petty Masonry)
 *   design_build           — Design-build; their showroom serves their own build
 *   salvage                — Salvage / reclaim yard, no brand partnerships
 *                            (Ohmega Salvage, Urban Ore, Building ReSources)
 *   made_to_order          — Fully bespoke, everything custom, no catalog
 */
export const showroomStoreType = sqliteTable(
  "showroom_store_type",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /**
     * Stable machine key (snake_case), e.g. "specialty_no_showroom". This is the
     * "enum" value — code and AI reference it; UNIQUE so it can't collide. The
     * human label lives in `displayName`; never render the key.
     */
    key: text("key").notNull(),

    /** Human label shown in the UI, e.g. "Specialty — no showroom". */
    displayName: text("display_name").notNull(),

    /** Prose describing what this business model means. */
    description: text("description"),

    /** Hex swatch for color-coding the type badge, e.g. "#4ade80". Nullable. */
    htmlColor: text("html_color"),

    /** Soft-delete — retire a type without breaking stores pointing at it. */
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    keyUniq: uniqueIndex("showroom_store_type_key_uniq").on(t.key),
  }),
);

export type ShowroomStoreType = typeof showroomStoreType.$inferSelect;
export type ShowroomStoreTypeInsert = typeof showroomStoreType.$inferInsert;
