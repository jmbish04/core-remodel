import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { images } from "./images";
import { imageTags } from "./image_tags";

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
