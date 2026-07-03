import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

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

  // ── Trade / access control ────────────────────────────────────────────

  /**
   * Trade-rep required flag — the homeowner must be accompanied by or act
   * through a licensed contractor, designer, or trade-account holder to visit
   * or purchase at this showroom.
   *
   * SUPERSEDES `isDesignerOnly` (which is retained in the schema as a
   * deprecated column but should no longer be written to for new data).
   * `isDesignerOnly` captured the same concept but with narrower semantics
   * (designer-specifically vs. any trade rep).  New code should read and
   * write `isTradeRepRequired` exclusively.
   */
  isTradeRepRequired: integer("is_trade_rep_required", { mode: "boolean" })
    .notNull()
    .default(false),

  // ── Google Places data ────────────────────────────────────────────────

  /**
   * Google Places aggregate star rating for this location (1.0–5.0).
   * Distinct from the homeowner's personal visit `rating` (integer 1–5).
   * Sourced from the Places API `rating` field; refreshed by the scrape agent.
   */
  googleRating: real("google_rating"),

  /**
   * Google Places total review count for this location.
   * Sourced from the Places API `userRatingCount` field; refreshed by the
   * scrape agent alongside `googleRating`.
   */
  userRatingCount: integer("user_rating_count"),

  /**
   * AI-generated summary of this location derived from Google user reviews.
   * Maps to the Places API `reviewSummary` field (markdown/plain text).
   * Shown read-only on the intake form and showroom viewport — not editable
   * by the homeowner; refreshed on each scrape run.
   */
  reviewSummary: text("review_summary"),

  // ── Agent-classified access level ─────────────────────────────────────

  /**
   * Homeowner access classification set by the scrape/research agent after
   * evaluating the showroom's website, hours, and reviews.
   *
   * Values:
   * - `PUBLIC_UNRESTRICTED`      — walk-in welcome; no trade account needed.
   * - `STRICT_TRADE_ONLY`        — trade account strictly required; homeowners
   *                                cannot visit or purchase without one.
   * - `HYBRID_ACCOMPANIED`       — homeowners may visit but MUST be accompanied
   *                                by a trade rep for the full session.
   * - `HYBRID_DEALER_NETWORK`    — homeowners can browse but purchase only
   *                                through an authorised dealer / trade account.
   * - `HYBRID_APPOINTMENT_ONLY`  — access open to homeowners by appointment;
   *                                no rep required but no walk-ins.
   * - `UNKNOWN`                  — agent could not determine access level from
   *                                available data; manual review needed.
   *
   * Nullable — null means the agent has not yet evaluated this store.
   * Used to drive the access-level badge in the showroom directory UI and to
   * gate or annotate the "Plan Visit" action.
   */
  accessLevel: text("access_level", {
    enum: [
      "PUBLIC_UNRESTRICTED",
      "STRICT_TRADE_ONLY",
      "HYBRID_ACCOMPANIED",
      "HYBRID_DEALER_NETWORK",
      "HYBRID_APPOINTMENT_ONLY",
      "UNKNOWN",
    ],
  }),

  /**
   * Agent's concise reasoning or supporting quote for the `accessLevel`
   * classification.  Plain text / one or two sentences extracted from the
   * showroom's website copy or reviews.  Shown as a tooltip or footnote on
   * the access-level badge.  Nullable — omitted when `accessLevel` is null.
   */
  accessLevelReasoning: text("access_level_reasoning"),

  // ── AI review insight (Places-details proxy output) ───────────────────

  /**
   * Full structured Gemini review-insight object produced by the Places-details
   * proxy after analysing Google reviews for this showroom.
   *
   * Shape:
   * ```json
   * {
   *   "summary": "...",
   *   "inferredPricePoint": "$$$$",
   *   "priceReasoning": "...",
   *   "attributes": {
   *     "appointmentOnly":    { "value": true,  "rationale": "..." },
   *     "flagshipLocation":   { "value": false, "rationale": "..." },
   *     "largeSelection":     { "value": true,  "rationale": "..." },
   *     "bespokeCurated":     { "value": false, "rationale": "..." },
   *     "tradeRepRequired":   { "value": true,  "rationale": "..." }
   *   },
   *   "reviewAuthenticity": {
   *     "assessment": "HIGH",
   *     "rationale": "...",
   *     "sources": ["..."]
   *   },
   *   "brands": [
   *     { "name": "Waterworks", "type": "plumbing", "websiteUrl": "https://..." }
   *   ]
   * }
   * ```
   *
   * IMPORTANT: the individual boolean columns (`isAppointmentOnly`,
   * `isFlagshipLocation`, `isLargeSelection`, `isBespoke`, `isTradeRepRequired`)
   * remain the authoritative queryable source of truth for filtering and
   * badge logic.  This column preserves the AI's full rationale, review-
   * authenticity assessment, and detected brand list for display-only use.
   * Do NOT drive query predicates from this JSON blob — read the typed boolean
   * columns instead.
   *
   * Nullable — null until the Places-details proxy has run for this store.
   */
  reviewAiInsight: text("review_ai_insight", { mode: "json" }).$type<{
    summary: string;
    inferredPricePoint: "$" | "$$" | "$$$" | "$$$$";
    priceReasoning: string;
    attributes: {
      appointmentOnly: { value: boolean; rationale: string };
      flagshipLocation: { value: boolean; rationale: string };
      largeSelection: { value: boolean; rationale: string };
      bespokeCurated: { value: boolean; rationale: string };
      tradeRepRequired: { value: boolean; rationale: string };
    };
    reviewAuthenticity: {
      assessment: string;
      rationale: string;
      sources: string[];
    };
    brands: Array<{
      name: string;
      type: string;
      websiteUrl: string;
    }>;
  }>(),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type ShowroomStore = typeof showroomStores.$inferSelect;
export type ShowroomStoreInsert = typeof showroomStores.$inferInsert;
