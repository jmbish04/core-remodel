import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { images } from "./images";

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
