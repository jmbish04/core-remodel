import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Image reviews table for retrofitted python script functionality
 */
export const imageReviews = sqliteTable("image_reviews", {
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
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
