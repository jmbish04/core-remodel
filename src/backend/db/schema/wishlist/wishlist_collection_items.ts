import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { wishlistCollections } from "./wishlist_collections";
import { wishlistItems } from "./wishlist_items";

/**
 * Wishlist Collection Items — M:N join between `wishlist_collections` and
 * `wishlist_items`.
 *
 * A single wishlist item can belong to multiple collections (e.g. a faucet
 * can be in both "Brass fixtures shortlist" and "Primary bath ideas"), and a
 * collection spans rooms by design — it groups items regardless of their
 * `wishlist_items.room_id`. Both FKs cascade on delete: removing a
 * collection or a wishlist item cleans up its membership rows.
 */
export const wishlistCollectionItems = sqliteTable(
  "wishlist_collection_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    collectionId: integer("collection_id")
      .notNull()
      .references(() => wishlistCollections.id, { onDelete: "cascade" }),

    wishlistItemId: integer("wishlist_item_id")
      .notNull()
      .references(() => wishlistItems.id, { onDelete: "cascade" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    collectionItemUnique: uniqueIndex(
      "wishlist_collection_items_collection_item_unique",
    ).on(table.collectionId, table.wishlistItemId),
    wishlistItemIdx: index("wishlist_collection_items_wishlist_item_idx").on(
      table.wishlistItemId,
    ),
  }),
);

export type WishlistCollectionItem =
  typeof wishlistCollectionItems.$inferSelect;
export type WishlistCollectionItemInsert =
  typeof wishlistCollectionItems.$inferInsert;
