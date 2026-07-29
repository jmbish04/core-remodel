import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";

/**
 * Material Schedule Items — the master list of materials/components to source
 * for the renovation (e.g. "Induction cooktop", "Primary closet system").
 *
 * This is the seed that feeds downstream showroom discovery, product sourcing,
 * gap analysis, and deep research.
 */
export const materialScheduleItems = sqliteTable("material_schedule_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  dateAdded: integer("date_added", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),

  title: text("title").notNull(),
  /**
   * Canonical room this material belongs to. HARD relationship: every material
   * is per-room ("Toilet — Primary Bath"), so `roomId` is a required M:1 FK.
   * The display name is derived by joining `rooms` — never stored (no
   * denormalized `room_name`).
   */
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  // `brand` / `model` text columns were removed (0039 P3): brand/model now
  // derive from the linked product via `productId` → products → brands. Never
  // store denormalized brand/model on the material.
  notes: text("notes"),

  /**
   * How many identical units this material represents in its one room. Null = 1.
   *
   * A receipt line can allocate as a GROUP into a single room — two sinks in a
   * double-vanity primary bath, three identical pendants over one island. That
   * is one material carrying `quantity`, distinct from the same line SPLIT across
   * rooms (which mints one material per room). The allocation plan decides which.
   */
  quantity: integer("quantity"),

  /**
   * The receipt line item this material was promoted from, when it came from an
   * emailed receipt. Nullable (materials also exist without a receipt) and NOT a
   * denormalized copy — provenance only. Lives here rather than relying on
   * `worker_email_invoice_line_items.material_schedule_item_id` because one line
   * (qty 2, split across two baths) mints MANY materials, and that single FK on
   * the line cannot point at all of them.
   */
  sourceLineItemId: integer("source_line_item_id"),

  isPurchased: integer("is_purchased", { mode: "boolean" }).default(false),
  /** Soft-delete flag (0039 P3). Every material READ must filter is_active. */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  /** Set when a purchased material was returned (0039 P3). */
  isReturned: integer("is_returned", { mode: "boolean" }).notNull().default(false),
  /**
   * The product this material was ultimately purchased as (if any). Renamed
   * from `purchased_showroom_product_id` (0039 P3). LOGICAL FK to `products`
   * (`showroom_store_products`) — kept a plain column, not a hard `.references()`,
   * to avoid the circular schema import (products already references
   * material_schedule_items). Resolve/validate against the live product set
   * before writing; join `products`→`brands` for brand/model display.
   */
  productId: integer("product_id"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type MaterialScheduleItem = typeof materialScheduleItems.$inferSelect;
export type MaterialScheduleItemInsert = typeof materialScheduleItems.$inferInsert;
