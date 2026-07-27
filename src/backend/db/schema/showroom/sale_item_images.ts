import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { saleItems } from "./sale_items";

/**
 * Sale Item Images — raw product image URLs for a sale item (0038).
 *
 * URLs are kept as the page's own `src` and are NOT re-uploaded to Cloudflare
 * Images (matches the harvested-imagery convention — `CF_IMAGES_SKIPPED`). The
 * frontend hotlinks them and, on an image `onError`, flips to a fallback icon;
 * `loadOk` persists that a URL was seen to fail so the fallback is sticky.
 */
export const saleItemImages = sqliteTable(
  "sale_item_images",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → sale_items.id; deletes cascade with the item. */
    saleItemId: integer("sale_item_id")
      .notNull()
      .references(() => saleItems.id, { onDelete: "cascade" }),

    /** Raw source URL as printed on the page. */
    imageUrl: text("image_url").notNull(),

    /** Display order within the item's carousel. */
    position: integer("position").notNull().default(0),

    alt: text("alt"),

    /** False once the URL is known to fail to load — show the fallback icon. */
    loadOk: integer("load_ok", { mode: "boolean" }).notNull().default(true),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    itemIdx: index("sale_item_images_item_idx").on(t.saleItemId, t.position),
  }),
);

export type SaleItemImage = typeof saleItemImages.$inferSelect;
export type SaleItemImageInsert = typeof saleItemImages.$inferInsert;
