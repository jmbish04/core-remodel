import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

import { brands } from "./brands";
import { brandTypesDef } from "./brand_types_def";

/**
 * Brand Type Mappings — many-to-many join between brands and their types.
 *
 * A brand can have multiple types (e.g. Waterworks covers "Plumbing" and
 * "Hardware"). Each mapping row is unique on (brandId, typeId) — the unique
 * index enforces this at the DB level.
 *
 * `brandIconCfImagesUrl` is per the product spec: the icon column lives on this
 * mapping table as a per-type icon override. The favicon worker may write a
 * type-specific brand icon here (e.g. a category-contextual logo variant)
 * while the canonical brand favicon lives on `brands.iconCfImagesUrl`.
 */
export const brandTypeMappings = sqliteTable(
  "brand_type_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** The brand being classified. Cascades to delete on brand removal. */
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),

    /**
     * Per-type icon override — Cloudflare Images delivery URL of a
     * category-contextual brand icon for this specific type mapping.
     * Falls back to `brands.iconCfImagesUrl` when null.
     */
    brandIconCfImagesUrl: text("brand_icon_cf_images_url"),

    /** The type being assigned. Cascades to delete on type removal. */
    typeId: integer("type_id")
      .notNull()
      .references(() => brandTypesDef.id, { onDelete: "cascade" }),

    /**
     * The one type that best represents this brand — a plumbing house that also
     * sells a few fixtures is a Plumbing brand first. Exactly zero or one row
     * per brand should carry this; it drives the highlighted primary badge and
     * the default sort. A soft flag, not a constraint: a brand with no primary
     * simply shows all its types unweighted.
     */
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    brandTypeUniq: uniqueIndex("brand_type_mappings_brand_type_uniq").on(
      t.brandId,
      t.typeId
    ),
  })
);

export type BrandTypeMapping = typeof brandTypeMappings.$inferSelect;
export type BrandTypeMappingInsert = typeof brandTypeMappings.$inferInsert;
