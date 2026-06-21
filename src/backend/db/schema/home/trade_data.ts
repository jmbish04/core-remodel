import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { workItemTypes } from "./work_item_types";

/**
 * Raw Truth Table construction activity catalog from insurance estimate.
 * Stores max unit price, SF Bay market adjustments, and SF multipliers.
 */
export const tradeData = sqliteTable(
  "trade_data",
  {
    id: text("id").primaryKey(),
    workItem: text("work_item").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    workItemTypeId: integer("work_item_type_id")
      .references(() => workItemTypes.id, { onDelete: "cascade" }),
    measurementType: text("measurement_type").notNull(), // SF, LF, EA, etc.
    maxUnitPrice: real("max_unit_price"),
    sfUnitPrice: real("sf_unit_price"),
    sfMultiplier: real("sf_multiplier"),
    rationale: text("rationale"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byCategory: index("idx_td_category").on(t.category),
    byWorkItemType: index("idx_td_work_item_type").on(t.workItemTypeId),
    uniqueWorkItem: uniqueIndex("ux_td_work_item_category").on(
      t.workItem,
      t.category,
    ),
  }),
);

export type TradeData = typeof tradeData.$inferSelect;
export type TradeDataInsert = typeof tradeData.$inferInsert;
