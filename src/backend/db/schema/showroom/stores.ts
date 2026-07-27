import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { storeBayareaCities } from "./bay_area_cities";
import { showroomStoreType } from "./store_types";

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

  /**
   * Business-model classification — single-select FK to `showroom_store_type`
   * (corporate, authorized_dealer, local_boutique, specialty_no_showroom, …).
   *
   * ORTHOGONAL to `showroom_store_category` (what the store SELLS, many-to-many).
   * This is HOW the business operates, and a store is exactly one, so it lives
   * here as a single FK — never a mapping table, never a denormalized type_name
   * (JOIN `showroom_store_type` for the display label). Nullable: legacy rows are
   * backfilled from the free-text `scale` descriptor and left for review.
   */
  typeId: integer("type_id").references(() => showroomStoreType.id, {
    onDelete: "set null",
  }),

  // ── Location details (per-row = per-physical-location) ────────────────
  bayAreaCityId: integer("bay_area_city_id").references(
    () => storeBayareaCities.id,
    { onDelete: "set null" }
  ),
  /** Full formatted address (Google `formattedAddress`) — display source. */
  locationAddress: text("location_address"),

  // ── Granular address parts ────────────────────────────────────────────
  // Parsed from Google Places `addressComponents` (or a submitted address
  // payload); callers may send a whole address and the worker fields it out.
  /** Street number, e.g. "1049". */
  locationStreetNumber: text("location_street_number"),
  /** Street / route name, e.g. "El Camino Real". */
  locationStreetName: text("location_street_name"),
  /** City / locality, e.g. "San Carlos". */
  locationCity: text("location_city"),
  /** State (2-letter), e.g. "CA". */
  locationState: text("location_state"),
  /** ZIP / postal code, e.g. "94070". Canonical granular zip. */
  locationZipCode: text("location_zip_code"),

  phoneNumber: text("phone_number"),
  emailAddress: text("email_address"),
  // Website + social URLs live in the showroom_store_links table. The flat
  // website_url/instagram_url/facebook_url/pinterest_url columns were removed
  // after the one-time links backfill (migration 0109).
  /** Legacy zip — kept in sync with `locationZipCode`; slated for removal. */
  zipCode: text("zip_code"),
  googleMapsLink: text("google_maps_link"),

  /**
   * Geographic coordinates for this location, captured at intake (from the
   * Google Places `location` field). Source of truth for individual map
   * markers and for deriving the region hub below. Nullable — legacy /
   * manual rows may not have coordinates until backfilled.
   */
  latitude: real("latitude"),
  longitude: real("longitude"),

  /**
   * Region hub CAPTURED for this specific location, derived from its address /
   * coordinates at intake (see `classifyBayAreaRegion`). Denormalized onto the
   * store so the directory filter and map are region-accurate WITHOUT joining
   * the legacy `store_bayarea_cities` table or calling the Places API on load.
   *
   * `hubRoute` is the A–E route letter; `hubName` the human-readable hub name
   * ("East Bay", "North Bay", …). Nullable — falls back to the city-derived hub
   * at read time when unset.
   */
  hubRoute: text("hub_route"),
  hubName: text("hub_name"),

  // ── Hours & access ────────────────────────────────────────────────────
  // Opening hours live SOLELY in the normalized `showroom_store_hours` table
  // (one row per open day). The API/MCP accept a structured hoursJson payload on
  // write and derive both the rows and `is_open_weekends`; responses rebuild
  // hoursJson from the rows. The legacy hours_json / weekday_hours /
  // weekend_hours columns were removed after backfill (migration 0109).
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
   * Soft-delete flag. `false` hides the store from every LIST/SEARCH surface —
   * the directory, map, drives, field scan, backfill candidates, MCP tools, the
   * sales/clearance sweep, gap analysis and the catalog — while leaving the row
   * and all its children (notes, photos, ratings, price observations) intact.
   *
   * Two deliberate exceptions keep working on an inactive row:
   *   - Fetch by explicit id (the detail viewport, get_showroom, every write
   *     path) — the caller already named the row, and hiding it would make a
   *     soft-deleted store impossible to inspect or restore.
   *   - The `placeId` dedupe checks — an inactive row still holds the unique
   *     `showroom_stores_place_id_uniq` index, so filtering it out would turn a
   *     clean 409 "already added" into a raw UNIQUE-constraint insert failure.
   *
   * Matches the `is_active` convention already used by showroom pocs, ratings,
   * categories, notes, tags and product areas.
   */
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

  /**
   * Online-only flag (0038) — this row is a web-only clearance source with no
   * physical showroom (no address / GPS). Added from the Sale Scan Health page
   * so web retailers' sales can be tracked alongside physical showrooms; drive
   * routing + map features should exclude these.
   */
  isOnlineOnly: integer("is_online_only", { mode: "boolean" })
    .notNull()
    .default(false),

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

  // ── Brand media ───────────────────────────────────────────────────────
  // Website / Instagram / Facebook / Pinterest URLs now live in the
  // showroom_store_links table (one row per link, typed).

  /**
   * Cloudflare Images delivery URL of the showroom's scraped favicon / brand icon.
   * Auto-populated by the favicon worker whenever the WEBSITE link is set/changed.
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
   * Google Places place ID for this showroom location.
   * Nullable — manual (non-Places) entries have no place ID.
   * Uniquely indexed (see `placeIdUniq` below) to prevent
   * intaking the same Google place twice; SQLite treats multiple `NULL`
   * values as distinct, so any number of manual-entry rows with a null
   * `place_id` are permitted — only non-null duplicates are blocked.
   */
  placeId: text("place_id"),

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
}, (t) => ({
  /**
   * Prevents intaking the same Google place twice. SQLite treats multiple
   * `NULL`s as distinct, so manual-entry rows (no `placeId`) are unaffected —
   * only non-null `placeId` duplicates are rejected.
   */
  placeIdUniq: uniqueIndex("showroom_stores_place_id_uniq").on(t.placeId),
}));

export type ShowroomStore = typeof showroomStores.$inferSelect;
export type ShowroomStoreInsert = typeof showroomStores.$inferInsert;
