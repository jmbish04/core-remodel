import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { images } from "./images";

export const imageTags = sqliteTable("image_tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export const imageTagMappings = sqliteTable(
  "image_tag_mappings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    imageId: text("image_id")
      .notNull()
      .references(() => images.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => imageTags.id, { onDelete: "cascade" }),
    source: text("source").notNull().default("manual"), // manual | ai_prefill
    aiRationale: text("ai_rationale"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    imageTagUnique: uniqueIndex("image_tag_mappings_image_tag_unique").on(
      table.imageId,
      table.tagId,
    ),
  }),
);

export const imageReviewHighlights = sqliteTable("image_review_highlights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  imageId: text("image_id")
    .notNull()
    .references(() => images.id, { onDelete: "cascade" }),
  highlightType: text("highlight_type").notNull().default("like"), // like | dislike
  shapeType: text("shape_type").notNull().default("rect"),
  xPct: real("x_pct").notNull(),
  yPct: real("y_pct").notNull(),
  widthPct: real("width_pct").notNull(),
  heightPct: real("height_pct").notNull(),
  note: text("note"),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
