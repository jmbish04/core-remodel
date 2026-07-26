import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Properties — the first-class, relational home for the target property/origin.
 *
 * Replaces the fragmented state where the property lived in three unrelated
 * places: the generic `/api/admin/config` KV (`permits_target_address/city/zip`),
 * a hardcoded `"126 Colby St, San Francisco, CA"` routing origin scattered through
 * the code, and a denormalized `permits_records.property_address` text copy. With
 * a real table, permits / drives / showroom-proximity can all JOIN "the property"
 * and a resale / multi-property future is free.
 *
 * ONE row is `is_primary` at a time (the active origin) — enforced by a partial
 * unique index. Rows-per-property make multi-property trivial later.
 *
 * The display address is DERIVED from the structured parts (`formatShowroomAddress`),
 * never a stored raw string — a free address field gets abused by AI (e.g. "SF Bay
 * area"). `latitude`/`longitude` are geocoded on write so every distance/proximity
 * consumer reads coords instead of re-geocoding per request.
 */
export const properties = sqliteTable(
  "properties",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** The active origin. Exactly one row may be true (partial unique index below). */
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),

    /** Human label, e.g. "126 Colby". */
    label: text("label"),

    // ── Structured address parts (no stored formatted string) ───────────────
    streetNumber: text("street_number"),
    streetName: text("street_name"),
    city: text("city"),
    state: text("state"),
    zipCode: text("zip_code"),

    placeId: text("place_id"),
    googleMapsLink: text("google_maps_link"),

    /** Geocoded on write; the source of truth for distance/proximity consumers. */
    latitude: real("latitude"),
    longitude: real("longitude"),

    // ── SF assessor identity (permit pipeline) ──────────────────────────────
    sfAssessorBlock: text("sf_assessor_block"),
    sfAssessorLot: text("sf_assessor_lot"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    /**
     * At most one primary property. SQLite partial unique index — only rows with
     * `is_primary = 1` are constrained, so any number of non-primary rows coexist.
     */
    primaryUniq: uniqueIndex("properties_primary_uniq")
      .on(t.isPrimary)
      .where(sql`${t.isPrimary} = 1`),
  }),
);

export type Property = typeof properties.$inferSelect;
export type PropertyInsert = typeof properties.$inferInsert;
