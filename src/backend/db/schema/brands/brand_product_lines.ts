import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { brands } from "./brands";

/**
 * Brand product lines — the "Top N products / product lines" the
 * BrandResearchWorkflow extracts for each brand (e.g. Kohler → "Purist",
 * "Artifacts"). Small, ordered, display-oriented rows for the brand viewport;
 * NOT the same as `showroom_store_products` (which are store-scoped items the
 * homeowner is actually tracking).
 */
export const brandProductLines = sqliteTable(
  "brand_product_lines",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Owner brand. */
    brandId: integer("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),

    /** Product / product-line name (e.g. "Purist Collection"). */
    name: text("name").notNull(),

    /** One-liner on what the line is / why it's notable. */
    description: text("description"),

    /** Coarse category (e.g. "Plumbing Fixtures", "Hardwood Flooring"). */
    productType: text("product_type"),

    /** Brand-site (or research) URL for the line, when found. */
    sourceUrl: text("source_url"),

    /** Display order — 0 is the flagship line. */
    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    brandIdx: index("brand_product_lines_brand_idx").on(table.brandId),
  }),
);

export type BrandProductLine = typeof brandProductLines.$inferSelect;
export type BrandProductLineInsert = typeof brandProductLines.$inferInsert;
