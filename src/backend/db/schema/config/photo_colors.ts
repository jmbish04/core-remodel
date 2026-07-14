// src/backend/db/schema/config/photo_colors.ts
import { sql } from "drizzle-orm";
import { sqliteTable, integer, uniqueIndex } from "drizzle-orm/sqlite-core";

import { colors } from "./colors";
import { productShowroomPhotos } from "../showroom/product_photos";

/**
 * Photo <-> Color mapping — many-to-many join between
 * `product_showroom_photos` and the shared `colors` vocabulary (AGENTS.md
 * "Multi-select & config-driven definitions"). One row per (photo, color)
 * pair; the unique index enforces no duplicate mappings.
 */
export const photoColors = sqliteTable(
  "photo_colors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    photoId: integer("photo_id")
      .notNull()
      .references(() => productShowroomPhotos.id, { onDelete: "cascade" }),

    colorId: integer("color_id")
      .notNull()
      .references(() => colors.id, { onDelete: "cascade" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    photoColorUniq: uniqueIndex("photo_colors_photo_color_uniq").on(
      table.photoId,
      table.colorId
    ),
  })
);

export type PhotoColor = typeof photoColors.$inferSelect;
export type PhotoColorInsert = typeof photoColors.$inferInsert;
