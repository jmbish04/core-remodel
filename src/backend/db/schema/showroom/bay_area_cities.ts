import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Bay Area Cities — reference table for geographic clustering.
 *
 * Each city belongs to a procurement hub (route) for day-trip planning:
 *   A = SF Design District (ultra-luxury core)
 *   B = Silicon Valley & South Bay (tech-integrated luxury)
 *   C = Peninsula / Mid-Market (scale & comprehensiveness)
 *   D = East Bay (fabrication, manufacturing, raw materials)
 *   E = North Bay (specialty & trade)
 */
export const storeBayareaCities = sqliteTable("store_bayarea_cities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bayAreaCityName: text("bay_area_city_name").notNull().unique(),
  distanceFromSanFrancisco: text("distance_from_san_francisco"),

  /** Hub route letter: A, B, C, D, E */
  hubRoute: text("hub_route"),

  /**
   * Human-readable hub name:
   *   "SF Design District", "Silicon Valley & South Bay",
   *   "Peninsula / Mid-Market", "East Bay", "North Bay"
   */
  hubName: text("hub_name"),
});

export type StoreBayareaCity = typeof storeBayareaCities.$inferSelect;
export type StoreBayareaCityInsert = typeof storeBayareaCities.$inferInsert;
