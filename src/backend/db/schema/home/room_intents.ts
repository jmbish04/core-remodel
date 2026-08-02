import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { impacts } from "../impacts/impacts";
import { projects } from "./projects";
import { roomIntentTypeDef } from "./room_intent_type_def";
import { rooms } from "./rooms";

/**
 * Room intents — how each room is treated in the remodel (0043 §5a).
 *
 * MANY INTENTS PER ROOM. The Toto case proves it: a bathroom getting only a
 * smart toilet is `TARGETED_FIXTURE` for the toilet AND `MEP_CHANGE` for the
 * outlet that toilet requires AND possibly `SURFACE_REFRESH` for floor
 * continuity. One column cannot hold that, so intent is a per-room set, not a
 * per-room value.
 *
 * `scope_level` is NOT here — it lives on `room_intent_type_def`. An earlier
 * draft carried both a `scopeLevel` and an `intentType` column on the instance,
 * and two columns encoding the same fact eventually disagree.
 *
 * `caused_by_impact_id` REPLACES a `hasTradeRippleEffect` boolean. A boolean
 * says work exists because of something elsewhere but not WHAT, and cannot be
 * traced. A ripple is an impact in the 0041 graph, so this links to it —
 * the outlet-work intent on the OTHER bathrooms points at the toilet-swap impact
 * that caused it. Do not add a boolean beside a graph that answers more.
 *
 * WHY EVERY ROOM GETS MAPPED, including out-of-scope ones: the hardwood case.
 * "I'm only remodeling the kitchen, why measure the rest of the house?" —
 * because the new floor has to match, and the moment that is decided the system
 * needs every room's square footage, and by then it is too late to gather it.
 * An `OUT_OF_SCOPE` intent is a real, first-class row: the room is mapped for
 * spatial continuity and context, and `roomReadiness()` asks nothing of it.
 */
export const roomIntents = sqliteTable(
  "room_intents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),

    roomId: integer("room_id")
      .notNull()
      .references(() => rooms.id, { onDelete: "cascade" }),

    intentTypeId: integer("intent_type_id")
      .notNull()
      .references(() => roomIntentTypeDef.id, { onDelete: "restrict" }),

    /**
     * The impact that CAUSED this intent, when it is a ripple rather than a
     * homeowner's own choice. Null for an intent the homeowner stated directly.
     * Not a boolean — the actual disruption, so its reach and blocking come for
     * free from the graph.
     */
    causedByImpactId: integer("caused_by_impact_id").references(() => impacts.id, {
      onDelete: "set null",
    }),

    /** proposed | committed | dropped */
    status: text("status").notNull().default("proposed"),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    roomIdx: index("room_intents_room_idx").on(table.roomId),
    projectIdx: index("room_intents_project_idx").on(table.projectId),
    causeIdx: index("room_intents_cause_idx").on(table.causedByImpactId),
  }),
);
