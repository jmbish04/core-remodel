import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

import { impacts } from "./impacts";

/**
 * What an impact reaches (0041 Phase 0).
 *
 * The mapping table that makes the impact model general. One impact touches any
 * number of heterogeneous targets — a lost tile sub delays the primary bath,
 * inflates a budget line, and blocks a final inspection, all at once — and each
 * reach carries its own verb.
 *
 * `targetKind` + `targetId` is a deliberate loose pair rather than seven
 * nullable FK columns. The alternative was a column per target type, which would
 * be almost entirely null on every row and would still need a discriminator.
 * The service layer resolves the pair; nothing writes one half without the other.
 *
 * `effect` is what the impact DOES to the target, and it is the verb the UI
 * renders and `nodeHealth()` scores:
 *
 *   reopens   invalidates a settled decision — the only effect that creates a
 *             decision_reopenings row, and it never moves the room's stop
 *   delays    pushes schedule
 *   inflates  pushes cost
 *   blocks    prevents the target from progressing at all
 *   informs   relevant context, no state change — deliberately weightless
 */
export const impactTargets = sqliteTable(
  "impact_targets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    impactId: integer("impact_id")
      .notNull()
      .references(() => impacts.id, { onDelete: "cascade" }),

    /**
     * room | decision | budget_line | permit | delivery | contractor | project
     */
    targetKind: text("target_kind").notNull(),

    targetId: integer("target_id").notNull(),

    /** reopens | delays | inflates | blocks | informs */
    effect: text("effect").notNull(),

    /** Why this target is affected — shown next to the highlighted node. */
    note: text("note"),

    /**
     * How this reach was determined. Inherits the impact's source by default but
     * can differ: a rule may create the impact while a human adds a target the
     * rule did not see.
     */
    source: text("source"),

    datetimeCreated: integer("datetime_created", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    // An impact reaches a given target with a given effect exactly once.
    impactTargetUnique: unique("impact_targets_impact_target_effect_unique").on(
      table.impactId,
      table.targetKind,
      table.targetId,
      table.effect,
    ),
    // "what is wrong with this room" — the blast-radius read, both directions.
    targetIdx: index("impact_targets_target_idx").on(table.targetKind, table.targetId),
    impactIdx: index("impact_targets_impact_idx").on(table.impactId),
  }),
);
