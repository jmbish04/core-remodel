import { sql } from "drizzle-orm";
import { integer, sqliteTable } from "drizzle-orm/sqlite-core";

import { rooms } from "../home/rooms";
import { bidPortfolios } from "./bid_portfolios";

/**
 * Per-room configuration for a bid portfolio — controls visible sections and ordering.
 */
export const bidPortfolioRoomConfigs = sqliteTable("bid_portfolio_room_configs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  portfolioId: integer("portfolio_id")
    .notNull()
    .references(() => bidPortfolios.id, { onDelete: "cascade" }),
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  includePhotos: integer("include_photos", { mode: "boolean" }).notNull().default(true),
  includeDimensions: integer("include_dimensions", { mode: "boolean" }).notNull().default(true),
  includeConditionNotes: integer("include_condition_notes", { mode: "boolean" }).notNull().default(true),
  includeScopeItems: integer("include_scope_items", { mode: "boolean" }).notNull().default(true),
  includeInspiration: integer("include_inspiration", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
