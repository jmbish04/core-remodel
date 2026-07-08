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
  roomName: text("room_name"),
  /**
   * Canonical room this material belongs to (0015 migration B). A material item
   * is per-room ("Toilet — Primary Bath"), so this is a plain M:1 FK. Nullable
   * + set-null-on-delete so a material can be un-roomed or outlive a merged
   * room; `roomName` remains a human-readable fallback/label.
   */
  roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
  brand: text("brand"),
  model: text("model"),
  notes: text("notes"),

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
