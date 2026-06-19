import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { rooms } from "../home/rooms";
import { floors } from "../home/floors";

/**
 * Images table for remodel mood board system.
 *
 * --- Inspiration scope (0005 REVISIONS — new feature) ---
 *
 * The original design fan-out expanded "Entire Floor / Entire Home" drops in
 * UploadsMappingPanel into one inspirational_image_rooms row per room.  A single
 * interior-door photo dropped on "All Levels" became N per-room rows, flooding
 * every room's inspiration view with the same repeated image.
 *
 * The fix: store SCOPE on the image itself instead of fanning out.
 *
 * inspirationScope — one of:
 *   "room"  → tied to specific canonical rooms via inspirational_image_rooms (default).
 *   "level" → applies to every active room on a single floor; scopeFloorId must be set.
 *   "home"  → applies to all active rooms across all floors; no per-room rows.
 *
 * scopeFloorId — FK to floors.id; non-null only when inspirationScope = "level".
 *
 * inspirationCategory — optional text label assigned on /review (AI-suggested + user-
 *   confirmed).  Examples: "Interior Doors", "Lighting", "Flooring", "Paint Colors".
 *   Null until categorized.  Primarily meaningful for level/home-scoped images.
 *
 * Consumer contract:
 *   - Per-room inspiration query = room-scoped (this room's inspirational_image_rooms)
 *     UNION level-scoped (inspirationScope='level' AND scopeFloorId = this room's floor)
 *     UNION home-scoped (inspirationScope='home').
 *   - level/home images render in a collapsed "Applies to whole level / whole home"
 *     appendix in the per-room view; they are never hero candidates (C3).
 *   - room-scoped images continue to use inspirational_image_rooms (multi-room allowed).
 */
export const images = sqliteTable(
  "images",
  {
    id: text("id").primaryKey(), // UUID
    displayName: text("display_name"),
    description: text("description"), // review/coding description
    cfImageIdOriginal: text("cf_image_id_original").notNull(),
    cfImageIdOptimized: text("cf_image_id_optimized"),
    photoCategory: text("photo_category").notNull().default("inspirational"), // inspirational | listing | ai_render
    roomId: integer("room_id").references(() => rooms.id, { onDelete: "set null" }),
    roomType: text("room_type"), // e.g., "kitchen", "bathroom", "living room"
    isInstagram: integer("is_instagram", { mode: "boolean" }).notNull().default(false),
    instagramAccount: text("instagram_account"),
    instagramCaption: text("instagram_caption"),
    metadata: text("metadata"), // JSON for keywords/structured AI response
    isListingPhoto: integer("is_listing_photo", { mode: "boolean" }).notNull().default(false),
    sourceFilename: text("source_filename"),
    sourceFilenameNormalized: text("source_filename_normalized"),
    sourceFileSize: integer("source_file_size"),
    sourceFileMd5: text("source_file_md5"),
    isDuplicate: integer("is_duplicate", { mode: "boolean" }).notNull().default(false),
    duplicateMarkedBy: text("duplicate_marked_by"),
    duplicateMarkedAt: integer("duplicate_marked_at", { mode: "timestamp" }),
    reviewed: integer("reviewed", { mode: "boolean" }).notNull().default(false), // photo-review/coding pass complete
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),

    /**
     * Scope of an inspirational image (see file docstring above for full explanation).
     *
     * Allowed values: "room" | "level" | "home"
     * Default: "room" — preserves existing behaviour for all pre-scope images.
     *
     * Only inspectional images (photoCategory = "inspirational") use this field.
     * Listing and ai_render images always have scope "room" and it is ignored.
     */
    inspirationScope: text("inspiration_scope").notNull().default("room"),

    /**
     * FK to floors.id — populated only when inspirationScope = "level".
     *
     * Records which floor this image applies to (e.g., upper_level flooring inspo
     * stored once instead of once per upper-level room).
     * Null when scope is "room" or "home".
     */
    scopeFloorId: integer("scope_floor_id").references(() => floors.id, {
      onDelete: "set null",
    }),

    /**
     * Human-readable category label assigned on /review.
     *
     * Examples: "Interior Doors", "Lighting", "Light Switches",
     *           "Drywall Finishes", "Flooring", "Paint Colors".
     * Null until the user confirms a category on the /review page.
     * AI may suggest it; user confirms.
     */
    inspirationCategory: text("inspiration_category"),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    sourceMd5Idx: index("images_source_file_md5_idx").on(table.sourceFileMd5),
    sourceFilenameSizeIdx: index("images_source_filename_size_idx").on(
      table.sourceFilenameNormalized,
      table.sourceFileSize,
    ),
    isDuplicateIdx: index("images_is_duplicate_idx").on(table.isDuplicate),
    /** Index for querying all level-scoped inspiration for a given floor quickly. */
    scopeFloorIdx: index("images_scope_floor_id_idx").on(table.scopeFloorId),
    /** Index for filtering all home/level-scoped inspiration images quickly. */
    inspirationScopeIdx: index("images_inspiration_scope_idx").on(table.inspirationScope),
  }),
);

