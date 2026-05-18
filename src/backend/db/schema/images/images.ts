import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { rooms } from "../home/rooms";

/**
 * Images table for remodel mood board system
 */
export const images = sqliteTable(
  "images",
  {
    id: text("id").primaryKey(), // UUID
    displayName: text("display_name"),
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
  }),
);
