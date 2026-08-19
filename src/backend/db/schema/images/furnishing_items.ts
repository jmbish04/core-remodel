import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";

/**
 * furnishing_items — persisted output of the Workshop's furnishing-extraction
 * (docs/0014, recipe 6.1). Each row is one detected furnishing/fixture/material
 * from a render, kept so a room's shopping list survives, can be curated
 * (dismiss / adopt), and later handed to the Decision Room to map onto a product.
 *
 * Re-extracting a node replaces that node's prior rows (delete-by-node + insert).
 */
export const furnishingItems = sqliteTable("furnishing_items", {
  id: text("id").primaryKey(), // UUID

  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),

  /** The board node the extraction ran on (plain column — board_nodes is in a sibling file). */
  sourceNodeId: text("source_node_id"),

  label: text("label").notNull(),
  category: text("category").notNull().default("other"),
  note: text("note").notNull().default(""),

  /** detected (default) | dismissed | adopted. */
  status: text("status").notNull().default("detected"),
  /** Optional link to a chosen product once the user adopts this item. */
  productId: integer("product_id"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type FurnishingItemRow = typeof furnishingItems.$inferSelect;
export type FurnishingItemInsert = typeof furnishingItems.$inferInsert;
