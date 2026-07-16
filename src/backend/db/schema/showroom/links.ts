import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// Direct leaf import — avoids circular reference through the showroom barrel.
import { showroomStores } from "./stores";

/**
 * The link-type vocabulary — the SINGLE SOURCE OF TRUTH.
 *
 * This list was copy-pasted into seven files (schema, utils/showroom-links,
 * services/showroom/social-links, the set_showroom_links MCP tool, the legacy
 * /api/mcp shim, showroom-contacts, and the LinksField frontend), so adding a
 * value meant seven edits and seven chances to miss one. Everything now derives
 * from here. It lives in the schema rather than utils/showroom-links because
 * that module imports this table — sourcing it the other way would be circular.
 *
 * D1 stores `type` as plain TEXT with no CHECK constraint (drizzle's `enum` is a
 * TypeScript-level constraint only, verified against the prod DDL), so adding a
 * value needs NO migration — existing rows are untouched and new values are
 * simply now spellable.
 */
export const SHOWROOM_LINK_TYPES = [
  "WEBSITE",
  /** A page dedicated to sales/clearance. Feeds the sale-tracking pipeline. */
  "WEBSITE_CLEARANCE",
  "INSTAGRAM",
  "PINTEREST",
  "FACEBOOK",
  "TWITTER_X",
  "LINKEDIN",
  "YELP",
  /** A Matterport (or equivalent) 360° walkthrough of the showroom. */
  "SHOWROOM_TOUR",
  /** A gallery page of photos OF the showroom itself. */
  "SHOWROOM_PHOTOS",
  "OTHER",
] as const;

export type ShowroomLinkType = (typeof SHOWROOM_LINK_TYPES)[number];

/**
 * Showroom Store Links — external URLs for a showroom location.
 *
 * Replaces the flat `website_url` / `instagram_url` / `facebook_url` /
 * `pinterest_url` columns that used to live on `showroom_stores`. One row per
 * link so a store can carry any number of each type (e.g. two Instagram
 * handles) plus arbitrary `OTHER` links classified via `urlNotes`.
 *
 * The store's primary website is the (typically single) `WEBSITE` row — the
 * favicon service reads it to hydrate the store icon.
 */
export const showroomStoreLinks = sqliteTable(
  "showroom_store_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → showroom_stores.id; deletes cascade so orphan links are cleaned up. */
    storeId: integer("store_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    /** The URL. Stored as entered; the UI normalizes schemeless values on render. */
    url: text("url").notNull(),

    /**
     * Link classification — see {@link SHOWROOM_LINK_TYPES}. `OTHER` covers
     * anything without a first-class type (e.g. "Houzz", "YouTube"); use
     * `urlNotes` to say what it is.
     */
    type: text("type", { enum: SHOWROOM_LINK_TYPES }).notNull(),

    /** Free-text classifier / label — the distinction for `type = OTHER`. */
    urlNotes: text("url_notes"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    storeIdx: index("showroom_store_links_store_idx").on(t.storeId),
  }),
);

export type ShowroomStoreLink = typeof showroomStoreLinks.$inferSelect;
export type ShowroomStoreLinkInsert = typeof showroomStoreLinks.$inferInsert;
