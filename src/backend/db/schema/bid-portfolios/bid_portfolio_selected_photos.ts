import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";
import { bidPortfolios } from "./bid_portfolios";
import { images } from "../images/images";

/**
 * Mapping table to explicitly select photos for a bid portfolio and allow caption overrides.
 */
export const bidPortfolioSelectedPhotos = sqliteTable("bid_portfolio_selected_photos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  portfolioId: integer("portfolio_id")
    .notNull()
    .references(() => bidPortfolios.id, { onDelete: "cascade" }),
  roomId: integer("room_id")
    .references(() => rooms.id, { onDelete: "cascade" }),
  imageId: text("image_id")
    .notNull()
    .references(() => images.id, { onDelete: "cascade" }),
  captionOverride: text("caption_override"),
  sortOrder: integer("sort_order").notNull().default(0),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
