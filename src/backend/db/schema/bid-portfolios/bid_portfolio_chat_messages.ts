import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { bidPortfolios } from "./bid_portfolios";

/**
 * Chat messages for AI-assisted conversations within a bid portfolio.
 */
export const bidPortfolioChatMessages = sqliteTable("bid_portfolio_chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  portfolioId: integer("portfolio_id")
    .notNull()
    .references(() => bidPortfolios.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // 'user' | 'assistant'
  content: text("content").notNull(),
  metadata: text("metadata"), // JSON
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
