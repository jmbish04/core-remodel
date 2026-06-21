import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

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
  }
);

export type ShowroomStoreCategoryType =
  typeof showroomStoreCategory.$inferSelect;
export type ShowroomStoreCategoryInsert =
  typeof showroomStoreCategory.$inferInsert;
export type ShowroomStoreCategoryMappingType =
  typeof showroomStoreCategoryMapping.$inferSelect;
export type ShowroomStoreCategoryMappingInsert =
  typeof showroomStoreCategoryMapping.$inferInsert;
