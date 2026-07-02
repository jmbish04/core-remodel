import { sql } from "drizzle-orm";
import { sqliteTable, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

// Direct leaf imports — avoids circular references through domain index barrels.
import { showroomStores } from "../showroom/stores";
import { brands } from "./brands";

/**
 * Showroom Brand Mappings — many-to-many join between showroom locations and brands.
 *
 * Records which brands are stocked / carried at a given showroom location.
 * Example: Studio Belmont (Belmont) carries THG Paris, Waterworks, and Bain Ultra.
 *
 * Each (showroomId, brandId) pair is unique — enforced at the DB level by the
 * unique index. Cascades to delete when either the showroom or the brand is removed.
 *
 * Import note: both `showroomStores` and `brands` are imported directly from
 * their leaf files (NOT their domain index barrels) to keep the module graph
 * acyclic — the brands barrel re-exports this file, so importing the showroom
 * barrel from here would create a cycle.
 */
export const showroomBrandMappings = sqliteTable(
  "showroom_brand_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** The showroom location carrying this brand. */
    showroomId: integer("showroom_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    /** The brand stocked at this showroom. */
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    showroomBrandUniq: uniqueIndex("showroom_brand_mappings_showroom_brand_uniq").on(
      t.showroomId,
      t.brandId
    ),
  })
);

export type ShowroomBrandMapping = typeof showroomBrandMappings.$inferSelect;
export type ShowroomBrandMappingInsert = typeof showroomBrandMappings.$inferInsert;
