import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { storeBayareaCities } from "./bay_area_cities";

/**
 * Showroom Stores — 1 row per physical location.
 *
 * If a brand has multiple Bay Area showrooms (e.g., Studio Belmont operates
 * in Belmont, SF, San Jose, Walnut Creek, Novato), each location is its own row.
 * This denormalization is intentional — each physical location has distinct
 * hours, inventory focus, scale, and POC.
 */
export const showroomStores = sqliteTable("showroom_stores", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  // ── Identity ──────────────────────────────────────────────────────────
  name: text("name").notNull(),
  description: text("description"),
  pricePoint: text("price_point", {
    enum: ["$", "$$", "$$$", "$$$$"],
  }),

  // ── Location details (per-row = per-physical-location) ────────────────
  bayAreaCityId: integer("bay_area_city_id").references(
    () => storeBayareaCities.id,
    { onDelete: "set null" }
  ),
  locationAddress: text("location_address"),
  phoneNumber: text("phone_number"),
  emailAddress: text("email_address"),
  websiteUrl: text("website_url"),
  zipCode: text("zip_code"),
  googleMapsLink: text("google_maps_link"),

  // ── Hours & access ────────────────────────────────────────────────────
  weekdayHours: text("weekday_hours"),
  weekendHours: text("weekend_hours"),
  isOpenWeekends: integer("is_open_weekends", { mode: "boolean" }).default(
    false
  ),
  isAppointmentOnly: integer("is_appointment_only", {
    mode: "boolean",
  }).default(false),

  // ── Location classification ───────────────────────────────────────────
  isFlagshipLocation: integer("is_flagship_location", {
    mode: "boolean",
  }).default(false),

  /**
   * Scale descriptor — free text describing showroom size & depth.
   * Examples:
   *   "Massive, dual-wing facility (separate plumbing/hardware sides)"
   *   "Highly curated boutique"
   *   "Factory + showroom"
   */
  scale: text("scale"),

  /**
   * Inventory focus — what this specific location specializes in.
   * Examples:
   *   "Largest comprehensive display of all brands, valves, and technical systems"
   *   "Focuses on statement pieces, European luxury (THG Paris)"
   */
  inventoryFocus: text("inventory_focus"),

  /**
   * Target demographic this location serves.
   * Examples:
   *   "Urban architects, Pacific Heights/Nob Hill renovations"
   *   "South Bay estates, tech executives, Silicon Valley architectural firms"
   */
  targetDemographic: text("target_demographic"),

  // ── Point of contact ──────────────────────────────────────────────────
  mainPocFullname: text("main_poc_fullname"),
  mainPocPhoneNumber: text("main_poc_phone_number"),
  mainPocEmailAddress: text("main_poc_email_address"),

  // ── Distance from SF (for route planning) ─────────────────────────────
  distanceFromSfTime: text("distance_from_sf_time"),
  distanceFromSfMiles: text("distance_from_sf_miles"),

  /**
   * AI-generated highlights explaining why THIS showroom location is
   * relevant to the user's specific renovation.
   *
   * The ShowroomResearchAgent scans D1 tables (rooms, moodboards, journal
   * entries, action items) to find alignment. For example:
   *   "User noted in journal that they want to view The Galley sink in
   *    person — this showroom carries The Galley line. User is also
   *    looking for whole-home water filtration; Studio Belmont's website
   *    advertises Franke filtration endpoints."
   */
  aiHighlightsForUserRenovation: text("ai_highlights_for_user_renovation"),

  // ── Notes (quick freeform from user) ──────────────────────────────────
  locationNotes: text("location_notes"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type ShowroomStore = typeof showroomStores.$inferSelect;
export type ShowroomStoreInsert = typeof showroomStores.$inferInsert;
