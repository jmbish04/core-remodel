import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { showroomStoreProducts } from "./store_products";

/**
 * Product Specs — structured specifications extracted from cited product pages.
 *
 * The table stores normalized key/value facts while keeping source URL and
 * metadata for traceability back to Browser Rendering/Gemini evidence.
 */
export const productSpecs = sqliteTable(
  "product_specs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    storeProductId: integer("store_product_id")
      .notNull()
      .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

    specKey: text("spec_key").notNull(),
    specValue: text("spec_value").notNull(),
    unit: text("unit"),
    sourceUrl: text("source_url"),
    confidence: integer("confidence").notNull().default(70),
    metadataJson: text("metadata_json"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    specUnique: uniqueIndex("product_specs_product_key_source_unique").on(
      table.storeProductId,
      table.specKey,
      table.sourceUrl,
    ),
    productIdx: index("product_specs_store_product_idx").on(table.storeProductId),
  }),
);

export type ProductSpec = typeof productSpecs.$inferSelect;
export type ProductSpecInsert = typeof productSpecs.$inferInsert;
