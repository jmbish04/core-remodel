import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { remodelScenarios } from "./remodel_scenarios";
import { rooms } from "./rooms";

/**
 * Action log for known room issues + planned tasks.
 * Can be linked to a specific scenario or remain global as-is context.
 */
export const roomActionItems = sqliteTable("room_action_items", {
  id: text("id").primaryKey(), // UUID
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  scenarioId: text("scenario_id").references(() => remodelScenarios.id, {
    onDelete: "set null",
  }),
  category: text("category").notNull().default("general"), // plumbing | electrical | structural | layout | budget | general
  title: text("title").notNull(),
  details: text("details"),
  status: text("status").notNull().default("open"), // open | in_progress | blocked | done
  priority: integer("priority").notNull().default(2), // 1 high, 2 med, 3 low
  estimatedCostCents: integer("estimated_cost_cents"),
  metadata: text("metadata"), // JSON
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
