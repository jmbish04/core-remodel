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
  brand: text("brand"),
  model: text("model"),
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
  /**
   * The showroom product this material was ultimately purchased as (if any).
   * Plain column rather than a hard FK to avoid a circular schema import with
   * `showroom_store_products` (which references `material_schedule_items`).
   */
  purchasedShowroomProductId: integer("purchased_showroom_product_id"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type MaterialScheduleItem = typeof materialScheduleItems.$inferSelect;
export type MaterialScheduleItemInsert = typeof materialScheduleItems.$inferInsert;
