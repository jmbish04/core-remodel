import { sql } from "drizzle-orm";
import {
  sqliteTable,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { saleItems } from "./sale_items";
import { colors } from "../config/colors";

/**
 * Sale Item Colors — mapping between a sale item and the shared `colors`
 * vocabulary (0038). The config-driven multi-select pattern: never a
 * comma-separated string. UNIQUE `(color_id, sale_item_id)` forbids dupes.
 */
export const saleItemColors = sqliteTable(
  "sale_item_colors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → colors.id. */
    colorId: integer("color_id")
      .notNull()
      .references(() => colors.id, { onDelete: "cascade" }),

    /** FK → sale_items.id. */
    saleItemId: integer("sale_item_id")
      .notNull()
      .references(() => saleItems.id, { onDelete: "cascade" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    uniq: uniqueIndex("sale_item_colors_uniq").on(t.colorId, t.saleItemId),
    itemIdx: index("sale_item_colors_item_idx").on(t.saleItemId),
  }),
);

export type SaleItemColor = typeof saleItemColors.$inferSelect;
export type SaleItemColorInsert = typeof saleItemColors.$inferInsert;
