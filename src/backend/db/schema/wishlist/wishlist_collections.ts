import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Wishlist Collections — named, cross-room groupings of wishlist items.
 *
 * In addition to the per-room / all-rooms organization on `wishlist_items`
 * itself, homeowners can curate freeform collections that cut across rooms
 * — e.g. "Warm minimalist palette", "Brass fixtures shortlist", "Gift ideas
 * from Mom". A collection is just a named bucket; membership is tracked via
 * the `wishlist_collection_items` join table.
 *
 * `isShared` marks a collection as intended for sharing outside the primary
 * homeowner account (e.g. with a spouse, contractor, or designer) — the
 * actual share/permission mechanics live at the application layer.
 */
export const wishlistCollections = sqliteTable("wishlist_collections", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  name: text("name").notNull(),
  description: text("description"),

  /** Cover image for the collection card/thumbnail. */
  coverImageUrl: text("cover_image_url"),

  /** Whether this collection is intended to be shared outside the account. */
  isShared: integer("is_shared", { mode: "boolean" }).default(false),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type WishlistCollection = typeof wishlistCollections.$inferSelect;
export type WishlistCollectionInsert = typeof wishlistCollections.$inferInsert;
