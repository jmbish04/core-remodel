import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { showroomStoreProducts } from "../showroom/store_products";

/**
 * Material Schedule Items — the master list of materials needed for the remodel.
 *
 * Each row is a line item like "Induction Cooktop" or "Primary Bath Vanity".
 * When a showroom product is purchased for this item, `isPurchased` flips to
 * true and `purchasedShowroomProductId` links to the actual product.
 */
export const materialScheduleItems = sqliteTable("material_schedule_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** When this item was added to the schedule. */
  dateAdded: integer("date_added", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),

  /** Human-readable title — e.g. "Induction Cooktop", "Primary Bath Faucet". */
  title: text("title").notNull(),

  /** Preferred or required brand (optional). */
  brand: text("brand"),

  /** Preferred or required model number (optional). */
  model: text("model"),

  /** Whether this material has been purchased. */
  isPurchased: integer("is_purchased", { mode: "boolean" }).default(false),

  /**
   * FK to showroom_store_products.id — the specific product that was purchased
   * to fulfill this material need. Nullable until purchased.
   */
  purchasedShowroomProductId: integer("purchased_showroom_product_id")
    .references(() => showroomStoreProducts.id, { onDelete: "set null" }),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type MaterialScheduleItem = typeof materialScheduleItems.$inferSelect;
export type MaterialScheduleItemInsert =
  typeof materialScheduleItems.$inferInsert;
