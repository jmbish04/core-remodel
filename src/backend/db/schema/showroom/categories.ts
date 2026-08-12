import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";

/**
 * Store Categories — what a showroom specializes in.
 *
 * Examples: Flooring, Windows/Doors, Plumbing/Hardware, Closets/Luxury,
 * Frameless Doors, Tile/Porcelain, Precast Concrete, Kitchen/InvisaCook,
 * Microcement, Architectural Lighting, Deck/Pedestal, etc.
 */
export const showroomStoreCategory = sqliteTable("showroom_store_category", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description"),
  /**
   * Parent UI grouping for the "Edit categories" modal + directory filters — a
   * flat TEXT bucket (e.g. "Surfaces & Finishes", "Kitchen & Bath") rather than a
   * recursive parent_id FK, so grouping stays a cheap in-memory reduce with no
   * self-join. Every active category belongs to exactly one group.
   */
  uiGroup: text("ui_group").notNull().default("General"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
});

/**
 * Category Mapping — links stores to categories (many-to-many).
 *
 * The ShowroomResearchAgent populates this based on web research and
 * store analysis. A store can map to multiple categories.
 */
export const showroomStoreCategoryMapping = sqliteTable(
  "showroom_store_category_mapping",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    storeId: integer("store_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),
    categoryId: integer("category_id")
      .notNull()
      .references(() => showroomStoreCategory.id, { onDelete: "cascade" }),

    /**
     * Why the ShowroomResearchAgent believes this store maps to this category.
     * Example: "Tredi Interiors is an authorized InvisaCook dealer and exclusive
     * California importer of Arrital Italian Kitchens, placing them squarely in
     * the Kitchen/InvisaCook category."
     */
    aiRationale: text("ai_rationale"),

    /**
     * 1-10 confidence score for the category linkage.
     * 10 = explicitly stated on store website / verified by user
     * 5  = inferred from product listings
     * 1  = speculative
     */
    aiRationaleConfidenceScore: integer("ai_rationale_confidence_score"),

    /**
     * Whether this category is the store's "bread and butter" —
     * what they are best known for / are specialists in.
     * A store may map to 5 categories but only 1-2 are bread & butter.
     */
    isBreadButter: integer("is_bread_butter", { mode: "boolean" }).default(
      false
    ),

    /**
     * The store's SINGLE primary category — the ONE it is most known for, which
     * decides the one group the store appears under on the directory (so a
     * multi-category store shows ONCE, in its primary group, instead of scattered
     * across every category it maps to). Distinct from `is_bread_butter` (1-2
     * "specialist" flags): exactly one row per store carries `is_primary = true`,
     * enforced by the partial-unique index below. Set from the intake classifier's
     * `primaryCategoryId`; the user can override in the Edit-categories modal.
     */
    isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  },
  (t) => ({
    /**
     * One row per (store, category).
     *
     * This table previously had NO index at all, which made every
     * `.onConflictDoNothing()` against it a silent no-op — it cannot detect a
     * conflict with no constraint to conflict on. Verified against prod on
     * 2026-07-21: zero duplicate pairs exist today, but only because the
     * fill-blanks guard happens to prevent re-runs. The scrape-side classifier
     * inserts on every run, so the guarantee has to live here.
     */
    storeCategoryUniq: uniqueIndex(
      "showroom_store_category_mapping_store_category_uniq",
    ).on(t.storeId, t.categoryId),
    /**
     * At most ONE primary category per store — the directory groups a store under
     * exactly this row. Partial (WHERE is_primary = 1) so the many non-primary
     * mappings are unconstrained. A second `is_primary` write for the same store
     * fails loud instead of silently scattering the store across groups.
     */
    onePrimaryPerStore: uniqueIndex("sscm_one_primary_per_store")
      .on(t.storeId)
      .where(sql`is_primary = 1`),
  }),
);

export type ShowroomStoreCategoryType =
  typeof showroomStoreCategory.$inferSelect;
export type ShowroomStoreCategoryInsert =
  typeof showroomStoreCategory.$inferInsert;
export type ShowroomStoreCategoryMappingType =
  typeof showroomStoreCategoryMapping.$inferSelect;
export type ShowroomStoreCategoryMappingInsert =
  typeof showroomStoreCategoryMapping.$inferInsert;
