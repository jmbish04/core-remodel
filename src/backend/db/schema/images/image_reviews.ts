import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Image reviews table for retrofitted python script functionality
 */
export const imageReviews = sqliteTable(
  "image_reviews",
  {
    id: text("id").primaryKey(), // UUID
    path: text("path").notNull(), // S3/R2 object key
    filename: text("filename").notNull(),
    room: text("room").default("unassigned"),
    tags: text("tags", { mode: "json" }), // JSON array of strings
    note: text("note").default(""),
    sourceFile: text("source_file"),
    imageNumber: text("image_number"),
    igAccount: text("ig_account"),
    visibleCaption: text("visible_caption"),
    width: integer("width"),
    height: integer("height"),
    sourceFilenameNormalized: text("source_filename_normalized"),
    sourceFileSize: integer("source_file_size"),
    sourceFileMd5: text("source_file_md5"),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    sourceMd5Idx: index("image_reviews_source_file_md5_idx").on(table.sourceFileMd5),
    sourceFilenameSizeIdx: index("image_reviews_source_filename_size_idx").on(
      table.sourceFilenameNormalized,
      table.sourceFileSize,
    ),
  }),
);
