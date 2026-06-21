import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";
import { bidPortfolios } from "./bid_portfolios";

/**
 * Comments left by portfolio viewers on specific sections or rooms.
 */
export const bidPortfolioComments = sqliteTable("bid_portfolio_comments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  portfolioId: integer("portfolio_id")
    .notNull()
    .references(() => bidPortfolios.id, { onDelete: "cascade" }),
  section: text("section"), // which slide/section the comment is on
  roomId: integer("room_id")
    .references(() => rooms.id, { onDelete: "set null" }),
  authorName: text("author_name").notNull(),
  authorEmail: text("author_email"),
  content: text("content").notNull(),
  isRead: integer("is_read", { mode: "boolean" }).notNull().default(false),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
