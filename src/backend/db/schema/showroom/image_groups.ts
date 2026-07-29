import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";

/**
 * Showroom Image Groups — named "folders" of visit photos, rendered as photo
 * stacks on the showroom detail viewport (0040 P3).
 *
 * A homeowner groups several photos of one thing (e.g. a product) into a folder,
 * gives it a name + description + pricing, and it shows as a stack. Photos link to
 * a group via the nullable `showroom_images.group_id` FK (null = a loose photo).
 */
export const showroomImageGroups = sqliteTable(
  "showroom_image_groups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    storeId: integer("store_id")
      .notNull()
      .references(() => showroomStores.id, { onDelete: "cascade" }),

    /** Folder display name, e.g. "Kohler Purist faucet — options". Required. */
    name: text("name").notNull(),

    /** Description as Markdown — the portable source of truth. */
    descriptionMarkdown: text("description_markdown"),
    /** Render-ready HTML derived from the Markdown by renderNoteHtml. */
    descriptionHtml: text("description_html"),

    // ── Pricing (repo convention: store BOTH the verbatim text AND numeric cents) ─
    /** Verbatim price string as entered, e.g. "$1,299 / pair" or "call for pricing". */
    priceText: text("price_text"),
    /** Numeric price in integer cents, for sort/compare/sum. */
    priceCents: integer("price_cents"),

    /**
     * Logical FK to `showroom_images.id` — the photo shown on top of the stack.
     * INTEGER to match the images PK. Kept as a plain column (no hard REFERENCES)
     * to avoid a circular constraint with `showroom_images.group_id`; validated in
     * the service layer instead.
     */
    coverImageId: integer("cover_image_id"),

    /** Ordering of stacks in the viewport. */
    sortOrder: integer("sort_order").notNull().default(0),

    /** Soft delete — never hard-delete a folder; loosen its photos and hide it. */
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    storeIdx: index("showroom_image_groups_store_idx").on(table.storeId),
  }),
);

export type ShowroomImageGroup = typeof showroomImageGroups.$inferSelect;
export type ShowroomImageGroupInsert = typeof showroomImageGroups.$inferInsert;
