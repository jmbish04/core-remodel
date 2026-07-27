import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { saleItems } from "./sale_items";

/**
 * Sale Watch — the operator's watch list of sale listings (0038).
 *
 * Distinct from the wishlist feature (design "wants" tied to products/
 * materials): this is "monitor THIS listing and call out changes"
 * (price/qty/color/gone/closeout). `userId` is nullable for the single-operator
 * default; promote to a required FK when multi-user lands. `lastNotifiedChange`
 * dedupes callouts so the same drop isn't surfaced every cycle.
 */
export const saleWatch = sqliteTable(
  "sale_watch",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → sale_items.id; deletes cascade with the item. */
    saleItemId: integer("sale_item_id")
      .notNull()
      .references(() => saleItems.id, { onDelete: "cascade" }),

    /** Nullable — single-operator default. */
    userId: text("user_id"),

    /** Timestamp of the last change we surfaced for this watch (dedupe). */
    lastNotifiedChange: integer("last_notified_change", { mode: "timestamp" }),

    note: text("note"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    uniq: uniqueIndex("sale_watch_uniq").on(t.saleItemId, t.userId),
  }),
);

export type SaleWatch = typeof saleWatch.$inferSelect;
export type SaleWatchInsert = typeof saleWatch.$inferInsert;
