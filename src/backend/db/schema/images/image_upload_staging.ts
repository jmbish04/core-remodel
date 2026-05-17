import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { images } from "./images";

/**
 * Upload staging queue for deferred room-mapping workflows.
 * A row is created when an image is uploaded and remains pending until mapped.
 */
export const imageUploadStaging = sqliteTable(
  "image_upload_staging",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    photoCategory: text("photo_category").notNull(), // listing | inspirational
    mappingStatus: text("mapping_status").notNull().default("pending"), // pending | mapped
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    datetimeMapped: integer("datetime_mapped", { mode: "timestamp" }),
  },
  (table) => ({
    imageUnique: uniqueIndex("image_upload_staging_image_unique").on(table.imageId),
  }),
);
