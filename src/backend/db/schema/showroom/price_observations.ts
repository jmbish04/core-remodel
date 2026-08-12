// src/backend/db/schema/showroom/price_observations.ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

// Direct leaf imports — avoid circular refs through the showroom barrel.
import { showroomStoreProducts } from "./store_products";
import { showroomStores } from "./stores";
import { showroomStoreLocations } from "./store_location";
import { productShowroomPhotos } from "./product_photos";

/**
 * Product Price Observations — the "different prices found across showrooms"
 * source of truth. Each row is ONE price captured from ONE source (a showroom
 * price card you photographed, an online retailer, or the manufacturer's MSRP).
 * Price is NOT a property of the product or the showroom mapping — it is a dated,
 * source-attributed observation, optionally backed by the photo it was read from.
 */
export const productPriceObservations = sqliteTable(
  "product_price_observations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    productId: integer("product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    /** Where this price came from. */
    sourceType: text("source_type", {
      enum: ["showroom", "online_retailer", "manufacturer"] as const,
    }).notNull(),

    /** Set when sourceType = 'showroom'. */
    showroomId: integer("showroom_id").references(() => showroomStores.id, {
      onDelete: "set null",
    }),

    /**
     * Physical site the price was observed at (Phase L, plan 0031). Set only when
     * sourceType = 'showroom'. Nullable = brand-level, online, or not-yet-backfilled;
     * FK → showroom_store_locations, ON DELETE SET NULL. Backfilled to the store's
     * primary location.
     */
    locationId: integer("location_id").references(() => showroomStoreLocations.id, {
      onDelete: "set null",
    }),

    /** Set when sourceType = 'online_retailer'. */
    retailerName: text("retailer_name"),
    retailerUrl: text("retailer_url"),

    /** Free-text display prices ("$1,299", "call for pricing"). */
    price: text("price"),
    salePrice: text("sale_price"),
    discountInfo: text("discount_info"),

    /** Numeric comparison pairs (derived from the text via money helpers). */
    priceCents: integer("price_cents"),
    salePriceCents: integer("sale_price_cents"),
    discountPct: real("discount_pct"),

    condition: text("condition", {
      enum: ["new", "floor_model", "clearance", "as_is"] as const,
    }),

    leadTime: text("lead_time"),
    notes: text("notes"),

    /** Visit / capture / scrape date. */
    observedAt: integer("observed_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /** FK to product_showroom_photos.id. Nullable. */
    sourcePhotoId: integer("source_photo_id").references(
      () => productShowroomPhotos.id,
      { onDelete: "set null" }
    ),

    /** 0–100; 100 for manual entry, lower for AI extraction. */
    confidence: integer("confidence").notNull().default(100),

    /** HITL. Manual entries may be inserted as 'approved'. */
    reviewStatus: text("review_status", {
      enum: ["pending", "approved", "rejected"] as const,
    })
      .notNull()
      .default("pending"),
    reviewReason: text("review_reason"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    productIdx: index("price_observations_product_idx").on(table.productId),
    showroomIdx: index("price_observations_showroom_idx").on(table.showroomId),
  })
);

export type ProductPriceObservation =
  typeof productPriceObservations.$inferSelect;
export type ProductPriceObservationInsert =
  typeof productPriceObservations.$inferInsert;
