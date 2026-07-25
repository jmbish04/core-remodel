import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Brand Types Definition — reference lookup for classifying brands by type.
 *
 * Examples of types: "Plumbing", "Hardware", "Stone & Tile", "Appliances",
 * "Lighting", "Cabinetry", "Flooring", "Windows & Doors".
 *
 * Types are softly deactivatable (`isActive = false`) rather than deleted,
 * so existing mappings remain intact if a type falls out of use.
 */
export const brandTypesDef = sqliteTable("brand_types_def", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** Human-readable type label, e.g. "Plumbing" or "Stone & Tile". */
  name: text("name").notNull(),

  /** Optional prose describing what brands of this type cover. */
  description: text("description"),

  /**
   * Why the description reads as it does — the model's reasoning behind the
   * classification, kept next to the prose so a human auditing the taxonomy
   * sees the justification, not just the output.
   */
  aiRationale: text("ai_rationale"),

  /**
   * Whether this type is actively used in the UI.
   * Set to false to retire a type without cascading deletes to mappings.
   */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type BrandTypesDef = typeof brandTypesDef.$inferSelect;
export type BrandTypesDefInsert = typeof brandTypesDef.$inferInsert;
