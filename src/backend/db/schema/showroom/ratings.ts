import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";
import { showroomStoreProducts } from "./store_products";
import { showroomStoreLocations } from "./store_location";

/**
 * Store Rating — user's personal rating of a showroom location.
 *
 * Supports revision history via replaced_by_id (self-referencing FK).
 * When a user updates their rating, the old row is deactivated and
 * linked to the new one.
 */
export const storeRating = sqliteTable("store_rating", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storeId: integer("store_id")
    .notNull()
    .references(() => showroomStores.id, { onDelete: "cascade" }),

  /**
   * Physical site this rating is about (Phase L, plan 0031). Nullable = brand-level or
   * not-yet-backfilled; FK → showroom_store_locations, ON DELETE SET NULL. Backfilled to
   * the store's primary location. Lets a user rate a specific site of a chain.
   */
  locationId: integer("location_id").references(() => showroomStoreLocations.id, {
    onDelete: "set null",
  }),

  rating: integer("rating").notNull(), // 1-5
  ratingNotes: text("rating_notes"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),

  /** Self-referencing FK: points to the newer rating that replaced this one. */
  replacedById: integer("replaced_by_id"),

  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),
});

/**
 * Store Product Rating — user's personal rating of a specific product.
 *
 * Same revision pattern as store_rating.
 */
export const storeProductRating = sqliteTable("store_product_rating", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storeProductId: integer("store_product_id")
    .notNull()
    .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

  rating: integer("rating").notNull(), // 1-5
  ratingNotes: text("rating_notes"),
  isActive: integer("is_active", { mode: "boolean" }).default(true),

  /** Self-referencing FK: points to the newer rating that replaced this one. */
  replacedById: integer("replaced_by_id"),

  createdAt: integer("created_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),
});

/**
 * Showroom Store Ratings (External) — aggregated ratings from review platforms.
 *
 * Populated by the ShowroomResearchAgent from Yelp, Google, Houzz, etc.
 * Each row = one rating from one source on one date.
 */
export const showroomStoreRatings = sqliteTable("showroom_store_ratings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storeId: integer("store_id")
    .notNull()
    .references(() => showroomStores.id, { onDelete: "cascade" }),

  /**
   * Physical site this external rating is for (Phase L, plan 0031). Nullable = brand-level
   * or not-yet-backfilled; FK → showroom_store_locations, ON DELETE SET NULL. Backfilled to
   * the store's primary location. A `source` of SYSTEM_USER carries the user's own rating
   * per location alongside the scraped platforms.
   */
  locationId: integer("location_id").references(() => showroomStoreLocations.id, {
    onDelete: "set null",
  }),

  /** The date the rating was recorded in its native source system (YYYY-MM-DD). */
  ratingCreated: text("rating_created"),

  /** Source platform: yelp, google, houzz, bbb, etc. */
  source: text("source").notNull(),

  /** The review comment / excerpt from the source. */
  comment: text("comment"),

  /** Rating in the source's scale, normalized to 1-5 stars. */
  rating: integer("rating").notNull(), // 1-5

  /** When we scraped/recorded this rating. */
  scrapedAt: integer("scraped_at", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),
});

export type StoreRatingType = typeof storeRating.$inferSelect;
export type StoreRatingInsert = typeof storeRating.$inferInsert;
export type StoreProductRatingType = typeof storeProductRating.$inferSelect;
export type StoreProductRatingInsert = typeof storeProductRating.$inferInsert;
export type ShowroomStoreRatingsType = typeof showroomStoreRatings.$inferSelect;
export type ShowroomStoreRatingsInsert =
  typeof showroomStoreRatings.$inferInsert;
