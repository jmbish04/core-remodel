import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { remodelScenarios } from "./remodel_scenarios";
import { rooms } from "./rooms";

/**
 * Per-room plan rows inside a scenario.
 * Lets an as-is room be repurposed into a to-be usage.
 */
export const scenarioRoomPlans = sqliteTable("scenario_room_plans", {
  id: text("id").primaryKey(), // UUID
  scenarioId: text("scenario_id")
    .notNull()
    .references(() => remodelScenarios.id, { onDelete: "cascade" }),
  roomId: integer("room_id")
    .notNull()
    .references(() => rooms.id, { onDelete: "cascade" }),
  proposedUse: text("proposed_use").notNull(), // e.g. kitchen, office, laundry
  stage: text("stage").notNull().default("considering"), // considering | draft | approved | rejected
  estimatedCostCents: integer("estimated_cost_cents"),
  notes: text("notes"),
  metadata: text("metadata"), // JSON
  datetimeCreated: integer("datetime_created", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  datetimeUpdated: integer("datetime_updated", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});
