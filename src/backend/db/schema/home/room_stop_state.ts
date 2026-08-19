import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { rooms } from "./rooms";

/**
 * A room's position on its line (0041 Phase 0 — the Diagram).
 *
 * The five stops are real trade progress, not mood phases:
 *
 *   SOURCING        looking, collecting, nothing committed
 *   FIXTURES_LOCKED every required fixture is an FK to a real product, not a wish
 *   ROUGH_IN        dimensions and rough-in tolerances recorded
 *   FINISH_SPEC     finishes, tolerances, and exclusions specified
 *   SIGNED_OFF      joint approval recorded
 *
 * THE STOP IS HIGH-WATER. It records the furthest point the room has ever
 * reached and it NEVER retreats. This is the single most important behavioural
 * rule in the plan.
 *
 * When something upstream invalidates a settled decision, the room keeps its
 * stop and the reopening is recorded separately (see `decision_reopenings`), so
 * the diagram renders "still at FINISH_SPEC, with 3 decisions reopened" rather
 * than sliding the marker back to SOURCING. Sliding it back is the exact visual
 * that makes a homeowner feel they lost two months, and it is where real
 * projects and real partnerships break.
 *
 * Enforcement lives in the service layer, not in a CHECK constraint, because the
 * comparison is ordinal over an enum. Any code path that lowers a room's stop is
 * a defect — there is a direct test for exactly that.
 *
 * History is preserved: one row per entry, and the current stop is the most
 * recent row. Nothing is updated in place, so "when did the kitchen reach
 * rough-in" is answerable forever.
 */
export const roomStopState = sqliteTable(
  "room_stop_state",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),

    /** SOURCING | FIXTURES_LOCKED | ROUGH_IN | FINISH_SPEC | SIGNED_OFF */
    stop: text("stop").notNull(),

    /**
     * Who or what advanced it — a household member id, an agent label, or a
     * system reason. Provenance is required on every state change in this plan.
     */
    enteredBy: text("entered_by"),

    /** Why it advanced, when that is not obvious from the stop alone. */
    reason: text("reason"),

    enteredAt: integer("entered_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    // "what is this room's current stop" — the hottest read in the diagram.
    roomEnteredIdx: index("room_stop_state_room_entered_idx").on(table.roomId, table.enteredAt),
  }),
);
