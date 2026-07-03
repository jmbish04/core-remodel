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
  /**
   * Structured opening hours — source of truth for the hours UI.
   *
   * Shape (all 7 keys always present; value is `null` when closed that day):
   * ```json
   * {
   *   "mon": { "open": "09:00", "close": "17:00" },
   *   "tue": { "open": "09:00", "close": "17:00" },
   *   "wed": { "open": "09:00", "close": "17:00" },
   *   "thu": { "open": "09:00", "close": "17:00" },
   *   "fri": { "open": "09:00", "close": "17:00" },
   *   "sat": { "open": "10:00", "close": "15:00" },
   *   "sun": null
   * }
   * ```
   * Times are 24-hour `"HH:MM"` strings in local showroom time (no timezone offset stored).
   *
   * `weekdayHours` and `weekendHours` are retained as derived human-readable summaries
   * for backward-compat display.  `isOpenWeekends` is derived from whether `sat`/`sun`
   * are non-null.
   */
  hoursJson: text("hours_json", { mode: "json" }).$type<{
    mon: { open: string; close: string } | null;
    tue: { open: string; close: string } | null;
    wed: { open: string; close: string } | null;
    thu: { open: string; close: string } | null;
    fri: { open: string; close: string } | null;
    sat: { open: string; close: string } | null;
    sun: { open: string; close: string } | null;
  }>(),

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
   * Large-selection flag — indicates a warehouse-scale or unusually broad
   * inventory (e.g. "Massive, dual-wing facility").  Replaces the free-text
   * `scale` field for intake filtering; `scale` is retained for legacy display.
   */
  isLargeSelection: integer("is_large_selection", {
    mode: "boolean",
  })
    .notNull()
    .default(false),

  /**
   * Bespoke / hand-curated flag — showroom carries exclusive, hand-selected,
   * or made-to-order collections.  Complements the free-text `scale` descriptor.
   */
  isBespoke: integer("is_bespoke", {
    mode: "boolean",
  })
    .notNull()
    .default(false),

  /**
   * Designer-only access flag — showroom explicitly requires or strongly
   * prefers working through a licensed designer or trade account.
   * Maps to `targetDemographic` language like "trade only" / "by referral".
   */
  isDesignerOnly: integer("is_designer_only", {
    mode: "boolean",
  })
    .notNull()
    .default(false),

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

  // ── Latest-visit rating (denormalized for quick display) ─────────────
  // NOTE: a full visit-history log lives in the `store_rating` table
  // (showroom/ratings.ts). The columns below are the denormalized snapshot
  // of the MOST RECENT visit so UIs can render the star badge without a join.

  /**
   * Latest visit star rating, 1–5.
   * Null means the store has never been rated.
   */
  rating: integer("rating"),

  /**
   * PlateJS-rendered HTML for the rating context note from the latest visit.
   * Served as-is in the UI — no further transformation needed.
   */
  ratingContextHtml: text("rating_context_html"),

  /**
   * The SAME rating context note serialized to Markdown by PlateJS.
   * Portable source of truth — use for export, search indexing, or AI context.
   */
  ratingContextMarkdown: text("rating_context_markdown"),

  // ── Social & brand media ──────────────────────────────────────────────
  /**
   * Public Instagram profile URL for this showroom location.
   * Example: "https://www.instagram.com/studiobelmontbath/"
   */
  instagramUrl: text("instagram_url"),

  /**
   * Cloudflare Images delivery URL of the showroom's scraped favicon / brand icon.
   * Auto-populated by the favicon worker whenever `websiteUrl` is set or changed.
   * Example: "https://imagedelivery.net/<accountHash>/<imageId>/public"
   */
  iconCfImagesUrl: text("icon_cf_images_url"),

  // ── Rich overview note (homeowner-authored) ───────────────────────────
  /**
   * Homeowner's rich overview note serialized to HTML by PlateJS.
   * Served as-is on the showroom viewport — no further transformation needed.
   */
  overviewNoteHtml: text("overview_note_html"),

  /**
   * The SAME overview note serialized to Markdown by PlateJS.
   * Portable / source form — use this for export, search indexing, or AI context.
   */
  overviewNoteMarkdown: text("overview_note_markdown"),

  // ── Scrape / RAG fields ───────────────────────────────────────────────
  /**
   * Stable UUID minted once per showroom before the Browser Rendering scrape
   * begins.  Every Vectorize embedding produced from this showroom's scraped
   * pages is tagged with this value so all content can be retrieved together
   * for RAG queries.  Also used as the logical FK in `browser_run_pages.rag_uuid`
   * (documented soft-link; not a hard FK because it targets a text column).
   */
  ragUuid: text("rag_uuid"),

  /**
   * Cloudflare Images delivery URL of the scraped storefront or interior photo
   * chosen as the hero background in the showroom viewport.
   * Populated by the browser scrape workflow after the best candidate image is
   * uploaded to CF Images.
   * Example: "https://imagedelivery.net/<accountHash>/<imageId>/public"
   */
  heroImageCfImagesUrl: text("hero_image_cf_images_url"),

  /**
   * Scrape pipeline status for this showroom.  Drives the status badge in the
   * showroom viewport and gates the "Start Scrape" / "Re-scrape" UI actions.
   *
   * - "idle"     — no scrape has been requested yet (default).
   * - "pending"  — scrape job enqueued but Browser Rendering has not started.
   * - "running"  — Browser Rendering workflow is actively crawling pages.
   * - "complete" — scrape finished; `browser_run_pages` rows are populated.
   * - "failed"   — scrape workflow terminated with an unrecoverable error.
   */
  scrapeStatus: text("scrape_status", {
    enum: ["idle", "pending", "running", "complete", "failed"],
  })
    .notNull()
    .default("idle"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type ShowroomStore = typeof showroomStores.$inferSelect;
export type ShowroomStoreInsert = typeof showroomStores.$inferInsert;
