// src/backend/db/schema/config/categories.ts
import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Categories — shared top-level vocabulary for the config-driven multi-select
 * pattern (AGENTS.md "Multi-select & config-driven definitions"). A single
 * `categories` definition table is reused across every owning object (photos,
 * brands, products, ...) via a generic object<->category mapping table rather
 * than a bespoke enum/comma-string per feature.
 *
 * Seeded values (0020-C2): stone, plumbing, cabinet, flooring, lighting,
 * tile, appliance, other.
 */
export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Display name, e.g. "Stone" or "Appliance". */
  name: text("name").notNull(),

  /** Optional prose describing what belongs in this category. */
  description: text("description"),

  /** Soft-delete flag — retire a category without breaking existing mappings. */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Category = typeof categories.$inferSelect;
export type CategoryInsert = typeof categories.$inferInsert;
