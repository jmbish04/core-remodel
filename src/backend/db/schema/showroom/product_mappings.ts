import { sql } from "drizzle-orm";
import { sqliteTable, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

// Direct leaf imports — avoids circular references through the showroom barrel
import { showroomStores } from "./stores";
import { showroomStoreProducts } from "./store_products";

/**
 * Showroom Product Mappings — records that a showroom "offers" a given product.
 *
 * Brands are derivable from the product row's `brandId` FK, so this table
 * does NOT duplicate the brand reference.
 *
 * The unique index prevents a product being mapped to the same showroom twice.
 */
export const showroomProductMappings = sqliteTable(
  "showroom_product_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /**
     * The showroom location that carries/offers this product.
     * Cascades to delete when the store row is removed.
     */
    showroomId: integer("showroom_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    /**
     * The product being mapped to this showroom.
     * Cascades to delete when the product row is removed.
     */
    productId: integer("product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    /**
     * Prevents duplicate (showroom, product) pairs. A product may only be
     * mapped to a given showroom once.
     */
    showroomProductUniq: uniqueIndex(
      "showroom_product_mappings_showroom_product_uniq"
    ).on(table.showroomId, table.productId),
  })
);

export type ShowroomProductMapping = typeof showroomProductMappings.$inferSelect;
export type ShowroomProductMappingInsert =
  typeof showroomProductMappings.$inferInsert;
