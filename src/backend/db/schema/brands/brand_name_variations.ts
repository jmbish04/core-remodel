import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { brands } from "./brands";

/**
 * Brand Name Variations — every spelling a brand is known by.
 *
 * WHY: a brand arrives spelled differently from every source. The showroom
 * scrape says "DORN BRACHT", a price card says "Dornbracht", a vendor PDF says
 * "Dornbracht GmbH". Matching on a single stored `brands.name` meant each new
 * spelling created a NEW brand row — that is how the table accumulated 9
 * duplicate pairs, each splitting its showroom mappings in half.
 *
 * Storing the variations instead of discarding them inverts the problem: every
 * spelling the system has ever seen becomes a lookup key, so the NEXT time that
 * spelling appears it matches an existing brand instead of forking a new one.
 * The set gets better the more sources it sees.
 *
 * `is_primary` is the display name. Correcting what a brand is called is then a
 * toggle rather than a rename — the old spelling stays as a (non-primary)
 * lookup key rather than being destroyed, which is exactly what you want:
 * "DORN BRACHT" should keep matching even once "Dornbracht" is the label.
 *
 * INVARIANT: exactly one active primary per brand, enforced in the DB by
 * `brand_name_variations_one_primary` (a PARTIAL unique index on brand_id where
 * is_primary = 1). Partial, because a plain UNIQUE(brand_id, is_primary) would
 * also forbid a brand having two NON-primary variations, which is the whole
 * point of the table.
 */
export const brandNameVariations = sqliteTable(
  "brand_name_variations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),

    /** One spelling of the brand, verbatim as encountered. */
    brandName: text("brand_name").notNull(),

    /**
     * Soft-delete. A wrong variation is deactivated rather than deleted so it
     * stops being offered as a display name but still records that the system
     * saw it — and can stop re-adding it on the next scrape.
     */
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    /** The display name. Exactly one per brand — see the partial index below. */
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),

    timestamp: integer("timestamp", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    /**
     * The single-primary invariant. Partial so it constrains only primaries.
     */
    onePrimary: uniqueIndex("brand_name_variations_one_primary")
      .on(table.brandId)
      .where(sql`${table.isPrimary} = 1`),

    /** No duplicate spellings within a brand. */
    nameUniq: uniqueIndex("brand_name_variations_brand_name_uniq").on(
      table.brandId,
      table.brandName,
    ),

    /** The lookup path: resolve an arbitrary spelling to a brand. */
    nameIdx: index("brand_name_variations_name_idx").on(table.brandName),
    brandIdx: index("brand_name_variations_brand_idx").on(table.brandId),
  }),
);

export type BrandNameVariation = typeof brandNameVariations.$inferSelect;
export type BrandNameVariationInsert = typeof brandNameVariations.$inferInsert;
