// src/backend/db/schema/config/subcategories.ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

import { categories } from "./categories";

/**
 * Subcategories — each row belongs to exactly one parent category. A
 * category/subcategory pair reconstructs for display as
 * `"{category.name} / {subcategory.name}"` (e.g. "Stone / Marble").
 *
 * Seeded values (0020-C2): Stone -> Marble, Porcelain, Quartzite;
 * Appliance -> Dishwasher, Cooktop, Microwave, Oven.
 */
export const subcategories = sqliteTable(
  "subcategories",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Display name, e.g. "Marble". Combined with the parent category name for display. */
    name: text("name").notNull(),

    /** Optional prose describing what belongs in this subcategory. */
    description: text("description"),

    /** Parent category. Every subcategory belongs to exactly one category. */
    categoryId: integer("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),

    /** Soft-delete flag — retire a subcategory without breaking existing mappings. */
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    categoryIdx: index("subcategories_category_idx").on(table.categoryId),
  })
);

export type Subcategory = typeof subcategories.$inferSelect;
export type SubcategoryInsert = typeof subcategories.$inferInsert;
