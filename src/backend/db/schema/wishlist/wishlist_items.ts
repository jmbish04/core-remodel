import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";
import { showroomStoreProducts } from "../showroom/store_products";
import { materialScheduleItems } from "../materials/schedule_item";

/**
 * Wishlist Items — the homeowner's "wants" layer over the products/materials
 * catalog.
 *
 * This table is intentionally lighter-weight than `material_schedule_items`:
 * it's where things land the moment a homeowner sees something they like
 * (a showroom product, a material, or just a freeform idea) and wants to
 * remember it — *before* it's committed to the actual material schedule for
 * the renovation. Think "save for later" / Pinterest-style board, scoped to
 * this home.
 *
 * Room scoping:
 * - `roomId` set → the item is tied to a specific room.
 * - `roomId` NULL → the item lives in the "All rooms" bucket. This is the
 *   home for cross-room items that don't belong to a single space — e.g. a
 *   paint color, a drywall texture, a lighting fixture style that might be
 *   used throughout the house.
 *
 * Catalog ties (both optional, and independent of each other):
 * - `showroomStoreProductId` links to a specific product tracked at a
 *   showroom (see `showroom_store_products`). Nullable — set-null on delete
 *   so a wishlist item survives the underlying product being removed; the
 *   denormalized `title`/`imageUrl`/`price` fields preserve the item's
 *   identity even after the link is severed.
 * - `materialScheduleItemId` links to an existing material schedule line
 *   (see `material_schedule_items`) when the wishlist item is an alternate/
 *   candidate for a material that's already being tracked. Nullable —
 *   set-null on delete for the same reason as above.
 * - An item can reference a product, a material, both, or neither (a pure
 *   freeform idea the homeowner typed in or saved from an image).
 *
 * Lifecycle: a wishlist item can be *promoted* to a real
 * `material_schedule_item` once the homeowner commits to it — that
 * promotion is an application-level operation (creates a new
 * `material_schedule_items` row and typically sets this item's `status` to
 * "chosen"), not a schema-level relationship, since the schedule item may
 * outlive the wishlist entry that inspired it.
 *
 * `status` lifecycle (informal, enforced at the app layer):
 *   "wishlist" → "considering" → "chosen" | "dismissed"
 */
export const wishlistItems = sqliteTable(
  "wishlist_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /**
     * Room this item belongs to. NULL = "All rooms" bucket (cross-room items
     * like paint, drywall, lighting that aren't scoped to one space).
     */
    roomId: integer("room_id").references(() => rooms.id, {
      onDelete: "set null",
    }),

    /** Optional link to a tracked showroom product. */
    showroomStoreProductId: integer("showroom_store_product_id").references(
      () => showroomStoreProducts.id,
      { onDelete: "set null" },
    ),

    /** Optional link to an existing material schedule line. */
    materialScheduleItemId: integer("material_schedule_item_id").references(
      () => materialScheduleItems.id,
      { onDelete: "set null" },
    ),

    /**
     * Denormalized display name — copied from the linked product/material at
     * add-time, or freeform text when the item has no catalog link.
     */
    title: text("title").notNull(),

    /** Denormalized thumbnail URL, snapshotted at add-time. */
    imageUrl: text("image_url"),

    /** Price snapshot at add-time (not live-synced to the source product). */
    price: real("price"),

    /** Freeform homeowner notes. */
    notes: text("notes"),

    /**
     * Wishlist lifecycle state.
     * "wishlist" (default, just saved) | "considering" (actively comparing) |
     * "chosen" (decided — typically promoted to a material_schedule_item) |
     * "dismissed" (ruled out, kept for history).
     */
    status: text("status").notNull().default("wishlist"),

    /** Manual ordering within a room/bucket — lower value = higher priority. */
    priority: integer("priority"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    roomIdx: index("wishlist_items_room_idx").on(table.roomId),
    storeProductIdx: index("wishlist_items_store_product_idx").on(
      table.showroomStoreProductId,
    ),
    materialItemIdx: index("wishlist_items_material_item_idx").on(
      table.materialScheduleItemId,
    ),
    statusIdx: index("wishlist_items_status_idx").on(table.status),
  }),
);

export type WishlistItem = typeof wishlistItems.$inferSelect;
export type WishlistItemInsert = typeof wishlistItems.$inferInsert;
