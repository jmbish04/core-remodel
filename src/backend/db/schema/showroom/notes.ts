import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

import { showroomStores } from "./stores";
import { showroomStoreProducts } from "./store_products";

/**
 * Store Notes — freeform notes on a store location.
 *
 * Supports revision tracking via is_active (soft delete when replaced).
 */
export const storeNotes = sqliteTable("store_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storeId: integer("store_id")
    .notNull()
    .references(() => showroomStores.id, { onDelete: "cascade" }),

  timestamp: integer("timestamp", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),

  /**
   * Legacy plain-text note body. Nullable so legacy rows remain valid while
   * new notes use the rich-text fields below instead.
   */
  note: text("note"),

  /** Short display title for the note (optional — legacy rows leave this null). */
  title: text("title"),

  /**
   * PlateJS-rendered HTML for the note body.
   * Served as-is in the UI — no further transformation needed.
   */
  contentHtml: text("content_html"),

  /**
   * The SAME note body serialized to Markdown by PlateJS.
   * Portable source of truth — use for export, search indexing, or AI context.
   */
  contentMarkdown: text("content_markdown"),

  /** Soft delete — set false when a note is superseded or deleted. */
  isActive: integer("is_active", { mode: "boolean" }).default(true),

  /** JSON string[] of free-form tags — selected/created via the note editor's multi-select. */
  tagsJson: text("tags_json"),
});

/**
 * Store Product Notes — freeform notes on a specific product.
 */
export const storeProductNotes = sqliteTable("store_product_notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  storeProductId: integer("store_product_id")
    .notNull()
    .references(() => showroomStoreProducts.id, { onDelete: "cascade" }),

  timestamp: integer("timestamp", { mode: "timestamp" }).default(
    sql`(unixepoch())`
  ),

  note: text("note").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(true),
});

export type StoreNote = typeof storeNotes.$inferSelect;
export type StoreNoteInsert = typeof storeNotes.$inferInsert;
export type StoreProductNote = typeof storeProductNotes.$inferSelect;
export type StoreProductNoteInsert = typeof storeProductNotes.$inferInsert;
