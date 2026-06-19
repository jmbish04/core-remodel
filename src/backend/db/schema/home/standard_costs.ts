import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

import { rooms } from "./rooms";
import { workItemTypes } from "./work_item_types";
import { tradeData } from "./trade_data";

/**
 * Granular room-level cost allocations with quantities, tax, O&P, and RCV.
 * References rooms, floors, and normalized work_item_types.
 */
export const standardCosts = sqliteTable(
  "standard_costs",
  {
    id: text("id").primaryKey(),
    roomId: integer("room_id")
      .references(() => rooms.id, { onDelete: "cascade" }),
    roomName: text("room_name").notNull(),
    floorName: text("floor_name").notNull(),
    workItem: text("work_item").notNull(),
    workItemTypeId: integer("work_item_type_id")
      .references(() => workItemTypes.id, { onDelete: "cascade" }),
    tradeDataId: text("trade_data_id")
      .references(() => tradeData.id, { onDelete: "set null" }),
    quantity: real("quantity").notNull(),
    measurementType: text("measurement_type").notNull(),
    unitPrice: real("unit_price"),
    sfUnitPrice: real("sf_unit_price"),
    tax: real("tax").default(0),
    overheadAndProfit: real("overhead_and_profit").default(0),
    rcv: real("rcv"),
    totalCost: real("total_cost"),
    totalSfCost: real("total_sf_cost"),
    notes: text("notes"),
    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => ({
    byRoom: index("idx_sc_room").on(t.roomId),
    byWorkItemType: index("idx_sc_work_item_type").on(t.workItemTypeId),
    byFloor: index("idx_sc_floor_name").on(t.floorName),
  }),
);

export type StandardCost = typeof standardCosts.$inferSelect;
export type StandardCostInsert = typeof standardCosts.$inferInsert;
