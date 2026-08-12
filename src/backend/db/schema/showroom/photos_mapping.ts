import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";
import { showroomStoreLocations } from "./store_location";

/**
 * Showroom Photos Mapping — Google Places photos uploaded to Cloudflare Images.
 *
 * One row per Places photo resource for a given showroom location.  The scrape
 * agent fetches the Places `photos` array, uploads each image to CF Images, and
 * writes a row here.  `sortOrder` preserves the Places API ordering so the UI
 * can display photos in Places rank (0 = hero/default photo).
 *
 * `authorAttributes` carries the Places `authorAttributions` array verbatim so
 * attribution can be rendered next to any photo without a secondary API call.
 */
export const showroomPhotosMapping = sqliteTable(
  "showroom_photos_mapping",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** FK → showroom_stores.id; deletes cascade so orphan rows are cleaned up. */
    showroomId: integer("showroom_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    /**
     * Physical site this photo belongs to (Phase L, plan 0031). Nullable = brand-level or
     * not-yet-backfilled; FK → showroom_store_locations, ON DELETE SET NULL. Backfilled to
     * the store's primary location.
     */
    locationId: integer("location_id").references(() => showroomStoreLocations.id, {
      onDelete: "set null",
    }),

    /** Cloudflare Images delivery URL for this photo. */
    cfImagesPhotoUrl: text("cf_images_photo_url").notNull(),

    /**
     * Google Places photo resource name.
     * Format: `places/{placeId}/photos/{photoReference}`
     * Useful for fetching fresh metadata or a higher-resolution variant.
     */
    photoName: text("photo_name"),

    /** Native pixel width reported by the Places API. */
    photoWidthPx: integer("photo_width_px"),

    /** Native pixel height reported by the Places API. */
    photoHeightPx: integer("photo_height_px"),

    /**
     * Places `authorAttributions` array serialized as JSON.
     *
     * Shape (zero or more entries):
     * ```json
     * [{ "displayName": "John D.", "uri": "https://...", "photoUri": "https://..." }]
     * ```
     * Render these credits alongside any displayed photo per Google's attribution
     * requirements.
     */
    authorAttributes: text("author_attributes", { mode: "json" }).$type<
      Array<{
        displayName: string;
        uri: string;
        photoUri: string;
      }>
    >(),

    /**
     * URL for flagging this photo as inappropriate via Google's flag-content flow.
     * Maps to the Places API `flagContentUri` field.
     */
    flagContentUri: text("flag_content_uri"),

    /**
     * Deep-link to this photo in Google Maps.
     * Maps to the Places API `googleMapsUri` field.
     */
    googleMapsUri: text("google_maps_uri"),

    /**
     * Display order matching the Places API array index for this showroom.
     * 0 = the default/hero photo (first in the Places `photos` list).
     * Preserves the ordering Google considers most relevant.
     */
    sortOrder: integer("sort_order").notNull().default(0),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    showroomIdx: index("showroom_photos_mapping_showroom_idx").on(
      table.showroomId,
    ),
  }),
);

export type ShowroomPhotoMapping = typeof showroomPhotosMapping.$inferSelect;
export type ShowroomPhotoMappingInsert =
  typeof showroomPhotosMapping.$inferInsert;
