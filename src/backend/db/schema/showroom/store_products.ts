import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { materialScheduleItems } from "../materials/schedule_item";
// Direct leaf import — avoids circular reference through the brands barrel
import { brands } from "../brands/brands";

/**
 * Store Products — individual items sourced or tracked at a showroom location.
 */
export const showroomStoreProducts = sqliteTable(
  "showroom_store_products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /**
     * The material schedule item this product is sourced for (nullable — a
     * product may be tracked before it's tied to a specific material).
     */
    materialId: integer("material_id").references(
      () => materialScheduleItems.id,
      { onDelete: "set null" }
    ),

    /**
     * The brand this product belongs to (nullable — may be populated after
     * initial entry, or left null for unbranded / generic items).
     * References the top-level brands table; cascades to null on brand deletion.
     */
    brandId: integer("brand_id").references(() => brands.id, {
      onDelete: "set null",
    }),

    timestamp: integer("timestamp", { mode: "timestamp" }).default(
      sql`(unixepoch())`
    ),

    itemName: text("item_name").notNull(),
    description: text("description"),
    colors: text("colors"),
    preferredColor: text("preferred_color"),
    sku: text("sku"),
    price: text("price"),

    /** Arbitrary structured data — dimensions, weight, model numbers, etc. */
    jsonDetails: text("json_details"),

    notes: text("notes"),
    leadTime: text("lead_time"),
    possibleDiscounts: text("possible_discounts"),
    tradeDiscount: text("trade_discount"),

    /**
     * Coarse product type / category used to group the global product list across
     * all brands (e.g. "Faucet", "Range", "Tile", "Sink"). Nullable — user-set;
     * populated when the homeowner categorises a product.
     */
    productType: text("product_type"),

    /** Real model identifier, promoted out of jsonDetails/sku. Nullable. */
    modelNumber: text("model_number"),

    /**
     * Normalized model number (normalizeModelKey) — the field the (brandId, modelKey)
     * unique index uses. Maintained app-side. Null for no-model# products (they never
     * collide: SQLite treats NULLs as distinct in unique indexes).
     */
    modelKey: text("model_key"),

    /** Manufacturer core / list price (MSRP) — text + numeric pair. Nullable. */
    msrp: text("msrp"),
    msrpCents: integer("msrp_cents"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    /** One product per (brand, normalized model#). NULL model_key rows are
     * distinct (SQLite treats NULLs as unequal), so no-model# products never collide. */
    brandModelUniq: uniqueIndex("showroom_store_products_brand_model_uniq").on(
      table.brandId,
      table.modelKey
    ),
  })
);

export type ShowroomStoreProduct = typeof showroomStoreProducts.$inferSelect;
export type ShowroomStoreProductInsert =
  typeof showroomStoreProducts.$inferInsert;
