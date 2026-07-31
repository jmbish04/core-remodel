import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

import { impacts } from "./impacts";

/**
 * One impact blocks another (0041 Phase 0).
 *
 * Bug-tracker semantics, and the reason the impact model is a graph rather than
 * a list: the tile sub cannot be replaced until the licensing complaint assigns
 * liability, so replacing the sub is blocked by the complaint.
 *
 * `nodeHealth()` walks these edges, which is what produces blast radius — an
 * unhealthy node highlights the connected nodes it threatens, in the same view,
 * never in a separate report.
 *
 * INVARIANT: a blocked impact cannot move to `resolved` while any blocking
 * impact is still open. Enforced in the service layer, with a direct test.
 *
 * Cycles are not prevented by the schema. They are prevented on write — a block
 * that would close a loop is rejected, because a cycle would make the resolve
 * rule unsatisfiable and would hang the traversal.
 */
export const impactBlocks = sqliteTable(
  "impact_blocks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** The impact that must resolve first. */
    blockingImpactId: integer("blocking_impact_id")
      .notNull()
      .references(() => impacts.id, { onDelete: "cascade" }),

    /** The impact that is held up. */
    blockedImpactId: integer("blocked_impact_id")
      .notNull()
      .references(() => impacts.id, { onDelete: "cascade" }),

    /** Why one blocks the other, in plain language. */
    note: text("note"),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    edgeUnique: unique("impact_blocks_edge_unique").on(
      table.blockingImpactId,
      table.blockedImpactId,
    ),
    // Both directions are walked: "what am I waiting on" and "what waits on me".
    blockedIdx: index("impact_blocks_blocked_idx").on(table.blockedImpactId),
    blockingIdx: index("impact_blocks_blocking_idx").on(table.blockingImpactId),
  }),
);
