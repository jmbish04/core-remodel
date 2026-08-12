import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { showroomImageGroups } from "./image_groups";
import { showroomStores } from "./stores";
import { showroomStoreLocations } from "./store_location";

/**
 * Showroom Images — storefront and showroom interior imagery discovered during
 * sourcing sweeps.
 *
 * No storefront-image table existed in the current showroom schema, so this
 * table captures Cloudflare Images deliveries for physical locations.
 */
export const showroomImages = sqliteTable(
  "showroom_images",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    storeId: integer("store_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    /**
     * Physical site this image belongs to (Phase L, plan 0031). Nullable = brand-level or
     * not-yet-backfilled; FK → showroom_store_locations, ON DELETE SET NULL. Backfilled to
     * the store's primary location.
     */
    locationId: integer("location_id").references(() => showroomStoreLocations.id, {
      onDelete: "set null",
    }),

    /**
     * Optional folder this photo belongs to (0040 P3). NULL = a loose photo shown
     * outside any stack. ON DELETE SET NULL so deleting a group loosens its photos
     * rather than destroying them.
     */
    groupId: integer("group_id").references(() => showroomImageGroups.id, {
      onDelete: "set null",
    }),

    sourceUrl: text("source_url").notNull(),
    sourcePageUrl: text("source_page_url"),
    cfImageId: text("cf_image_id"),
    deliveryUrl: text("delivery_url").notNull(),

    altText: text("alt_text"),
    imageKind: text("image_kind", {
      // "visit" = homeowner-uploaded visit photo; the rest are discovered by the
      // sourcing sweep. The "Your visit photos" card must only ever show "visit".
      enum: ["visit", "storefront", "showroom", "logo", "map", "unknown"],
    })
      .notNull()
      .default("unknown"),
    width: integer("width"),
    height: integer("height"),
    mimeType: text("mime_type"),
    ogTitle: text("og_title"),
    ogDescription: text("og_description"),
    metadataJson: text("metadata_json"),

    // ── Polaroid back note ────────────────────────────────────────────────
    /**
     * PlateJS-rendered HTML shown on the back of the polaroid card for this
     * visit photo. Null when no note has been added.
     */
    noteHtml: text("note_html"),

    /**
     * The SAME polaroid note serialized to Markdown by PlateJS.
     * Portable source of truth for export or AI context.
     */
    noteMarkdown: text("note_markdown"),

    /** HITL review state — see product_images.review_status (junk rejection). */
    reviewStatus: text("review_status", {
      enum: ["pending", "approved", "rejected"],
    })
      .notNull()
      .default("pending"),
    reviewReason: text("review_reason"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    sourceUnique: uniqueIndex("showroom_images_store_source_unique").on(
      table.storeId,
      table.sourceUrl,
    ),
    storeIdx: index("showroom_images_store_idx").on(table.storeId),
  }),
);

export type ShowroomImage = typeof showroomImages.$inferSelect;
export type ShowroomImageInsert = typeof showroomImages.$inferInsert;
