import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Direct leaf imports — avoid a circular reference through the showroom barrel.
import { storeBayareaCities } from "./bay_area_cities";
import { showroomStores } from "./stores";

/**
 * Showroom Store Locations — the relational home for a store's location data
 * (plan 0031). **1:MANY** — a brand/chain with multiple Bay Area sites (Studio
 * Belmont, TAZ, IRG, natural-stone yards…) is ONE `showroom_stores` row with N
 * location rows, instead of a duplicate store per site. The parent store holds
 * brand-level identity (name, description, brand, categories, products); each
 * location holds its own address, coords, place, hub, and location-specific
 * notes ("the SF site is designer-only").
 *
 * Design decisions baked in:
 *   - **No `location_address` column.** A free formatted address gets abused by
 *     AI (e.g. "SF Bay area"), so it is a parse-SOURCE only during backfill and
 *     is never stored here — the display address is DERIVED from the structured
 *     parts (`formatShowroomAddress`).
 *   - **Hub is derived, not stored.** `bay_area_city_id` (+ the region lib)
 *     yields the hub at read time; no captured `hub_route`/`hub_name`.
 *   - **Notes are a PlateJS triple** — plaintext + markdown + html — matching the
 *     repo's `OverviewNoteEditor` / `notes_markdown`+`notes_html` convention.
 *   - **`distance_from_sf_*` is NOT here** — distance is derived at read from the
 *     property/origin config (plan 0032), never stored.
 */
export const showroomStoreLocations = sqliteTable(
  "showroom_store_locations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Owning brand/chain store (1:many). Cascades so locations die with the store. */
    storeId: integer("store_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    /**
     * Google Places id. Nullable — manual rows have none. Uniquely indexed
     * (nulls distinct in SQLite) to prevent intaking the same place twice; the
     * dedupe index moves here from `showroom_stores`.
     */
    placeId: text("place_id"),
    googleMapsLink: text("google_maps_link"),

    /** Region-clustering FK; the hub is derived from this join at read time. */
    bayAreaCityId: integer("bay_area_city_id").references(() => storeBayareaCities.id, {
      onDelete: "set null",
    }),

    latitude: real("latitude"),
    longitude: real("longitude"),

    // ── Structured address parts (no stored formatted string) ───────────────
    streetNumber: text("street_number"),
    streetName: text("street_name"),
    city: text("city"),
    state: text("state"),
    zipCode: text("zip_code"),

    // ── Notes — PlateJS triple ──────────────────────────────────────────────
    /** Plaintext (search / portable). */
    notes: text("notes"),
    /** Markdown source of truth. */
    notesMarkdown: text("notes_markdown"),
    /** Render-ready HTML cache. */
    notesHtml: text("notes_html"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    /** Fast lookup of a store's locations (1:many — NOT unique). */
    storeIdx: index("showroom_store_locations_store_idx").on(t.storeId),
    /** Dedupe by Google place (nulls distinct — manual rows unaffected). */
    placeIdUniq: uniqueIndex("showroom_store_locations_place_id_uniq").on(t.placeId),
  }),
);

export type ShowroomStoreLocation = typeof showroomStoreLocations.$inferSelect;
export type ShowroomStoreLocationInsert = typeof showroomStoreLocations.$inferInsert;
