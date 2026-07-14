import { sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

// Direct leaf import — avoids circular reference through the showroom barrel.
import { showroomStores } from "./stores";

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
     * Link classification. `OTHER` covers anything not a first-class social /
     * website link — use `urlNotes` to say what it is (e.g. "Houzz", "Yelp").
     */
    type: text("type", {
      enum: ["WEBSITE", "INSTAGRAM", "PINTEREST", "FACEBOOK", "OTHER"],
    }).notNull(),

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
