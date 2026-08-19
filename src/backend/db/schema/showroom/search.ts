import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { showroomExclusions } from "./exclusions";
import { showroomStores } from "./stores";

/**
 * Discovery-search tables (0032 D2 / 0022 §5.7) — the on-demand "find me showrooms
 * near here" finder.
 *
 * Unlike the park-find HITL queue (`showroom_store_hitl_queue`, decision 1.d — the
 * car parked somewhere unknown), this is a USER/AI-initiated sweep: "what remodel
 * showrooms are near Livermore right now?". It is worker-orchestrated and D1-backed —
 * the model only orchestrates (submits `aiResults` + params), the worker runs the
 * Places sweep, dedupes against the directory + exclusions, ranks with Gemini, and
 * OWNS the rendered result. Each search is a shareable slug the user can open while
 * still talking to Claude; every change to it is a numbered revision (so the model
 * can always cite "revision N"), mirroring the artifact-revision pattern.
 *
 * FK rule (AGENTS.md): a result relates to its already-in-directory store by
 * `existingStoreId` and to the exclusion that hid it by `matchedExclusionId` — the
 * display name is JOINed, never denormalized. The candidate's own `name`/address are
 * point-in-time Places snapshots (a search artifact), so they live here legitimately.
 */

/** One orchestrated search — a slug the user can open mid-conversation. */
export const showroomSearch = sqliteTable(
  "showroom_search",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Shareable page key — `/admin/shopping/showrooms/finder/<slug>`. */
    slug: text("slug").notNull(),
    /** Human label the model gives it ("Remodel showrooms near Livermore, 1pm"). */
    title: text("title"),

    /**
     * The full query as JSON: near (point/area/`current-location`), radiusM, query?,
     * broad, excludeDirectory (default true), excludeNotInterested (default true),
     * likeStoreId?, excludeCategories?, excludeStoreIds?.
     */
    paramsJson: text("params_json"),

    /**
     * Slug lifecycle. A fresh slug is PENDING (`ready`, not yet `final`) until the AI
     * or user marks it `final`. (TEXT column — adding a value is a TS-only change.)
     */
    status: text("status", { enum: ["running", "ready", "refining", "final", "error"] })
      .notNull()
      .default("running"),

    /** Latest revision number (see `showroom_search_revision`). */
    currentRevision: integer("current_revision").notNull().default(0),
    /** Short worker/AI summary of the result set. */
    summary: text("summary"),
    resultCount: integer("result_count").notNull().default(0),

    /** How the search was initiated: `mcp` (voice/chat) or `ui`. */
    origin: text("origin", { enum: ["mcp", "ui"] }),
    /** Chat/session ref that spawned it (for the receipts). */
    originConversation: text("origin_conversation"),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    // One page per slug — the shareable key.
    slugUniq: uniqueIndex("showroom_search_slug_uniq").on(t.slug),
    statusIdx: index("showroom_search_status_idx").on(t.status),
  }),
);

/** Every change to a slug is a numbered revision (mirrors `artifact_revisions`). */
export const showroomSearchRevision = sqliteTable(
  "showroom_search_revision",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    searchId: integer("search_id")
      .notNull()
      .references(() => showroomSearch.id, { onDelete: "cascade" }),
    /** 1-based, per search. */
    revisionNumber: integer("revision_number").notNull(),

    /** The params used for THIS revision. */
    paramsJson: text("params_json"),
    /** Where this revision's results came from. */
    source: text("source", { enum: ["places", "ai", "mixed"] }).notNull(),
    /** Whether the Places API was actually called (vs hard-disabled by quota). */
    usedPlaces: integer("used_places", { mode: "boolean" }).notNull().default(false),
    /** e.g. "excluded 'appointment only' + Foo Tile". */
    changeNote: text("change_note"),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    // A revision number is unique within its search.
    searchRevUniq: uniqueIndex("showroom_search_revision_search_rev_uniq").on(
      t.searchId,
      t.revisionNumber,
    ),
    searchIdx: index("showroom_search_revision_search_idx").on(t.searchId),
  }),
);

/** Result rows for a search (replaced on refine of the same slug). */
export const showroomSearchResult = sqliteTable(
  "showroom_search_result",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    searchId: integer("search_id")
      .notNull()
      .references(() => showroomSearch.id, { onDelete: "cascade" }),
    /** Which revision produced this row. */
    revisionId: integer("revision_id")
      .notNull()
      .references(() => showroomSearchRevision.id, { onDelete: "cascade" }),

    /** Google Place id when available (the dedupe/exclusion match key). */
    placeId: text("place_id"),
    name: text("name"),

    // Normalized address — mirrors `showroom_stores` (never a single blob).
    locationStreetNumber: text("location_street_number"),
    locationStreetName: text("location_street_name"),
    locationCity: text("location_city"),
    locationState: text("location_state"),
    locationZipCode: text("location_zip_code"),
    /** Display/copy address string. */
    fullAddress: text("full_address"),

    latitude: real("latitude"),
    longitude: real("longitude"),

    /** Drive the type badges. */
    categoryGuess: text("category_guess"),
    primaryType: text("primary_type"),

    /** Click-to-dial (`tel:`). */
    phone: text("phone"),
    website: text("website"),
    /** Stars badge when available. */
    googleRating: real("google_rating"),
    userRatingCount: integer("user_rating_count"),
    /** Places hours JSON → viewport computes open/closing-soon/closed relative to search time. */
    openingHoursJson: text("opening_hours_json"),

    /** Where THIS candidate came from: model-submitted (`ai`) vs Places sweep. */
    source: text("source", { enum: ["places", "ai"] }).notNull(),
    /** 0–1 relevance score. */
    aiRelevance: real("ai_relevance"),
    aiReasoning: text("ai_reasoning"),
    /** Metres from the search point. */
    distanceM: real("distance_m"),

    /** Already a registered showroom. */
    inDirectory: integer("in_directory", { mode: "boolean" }).notNull().default(false),
    /** The registered store when `inDirectory` (FK — name is JOINed, never copied). */
    existingStoreId: integer("existing_store_id").references(() => showroomStores.id, {
      onDelete: "set null",
    }),

    /** Matched the not-interested list (kept + flagged, reported separately, hidden from main list). */
    isExcluded: integer("is_excluded", { mode: "boolean" }).notNull().default(false),
    /** Which exclusion matched — so the model can explain WHY it was dropped. */
    matchedExclusionId: integer("matched_exclusion_id").references(() => showroomExclusions.id, {
      onDelete: "set null",
    }),

    /** Set when the user/AI imports this result into the directory. */
    importedAt: integer("imported_at", { mode: "timestamp" }),
    /** Sort order within the revision. */
    rank: integer("rank"),

    createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  },
  (t) => ({
    searchIdx: index("showroom_search_result_search_idx").on(t.searchId),
    revisionIdx: index("showroom_search_result_revision_idx").on(t.revisionId),
    placeIdx: index("showroom_search_result_place_idx").on(t.placeId),
  }),
);

export type ShowroomSearch = typeof showroomSearch.$inferSelect;
export type ShowroomSearchInsert = typeof showroomSearch.$inferInsert;
export type ShowroomSearchRevision = typeof showroomSearchRevision.$inferSelect;
export type ShowroomSearchRevisionInsert = typeof showroomSearchRevision.$inferInsert;
export type ShowroomSearchResult = typeof showroomSearchResult.$inferSelect;
export type ShowroomSearchResultInsert = typeof showroomSearchResult.$inferInsert;
