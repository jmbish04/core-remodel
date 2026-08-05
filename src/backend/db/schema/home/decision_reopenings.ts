import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { decisions } from "./decisions";

/**
 * Why a settled decision was reopened (0041 Phase 0).
 *
 * NO UNATTRIBUTED REGRESSION. A decision never quietly stops being true. Every
 * reopening names its cause, and the room's stop does not move — the reopening
 * renders as a separate marker beneath a line that keeps its position.
 *
 * The wound this fixes: a homeowner turns a room to FINISH_SPEC, comes back and
 * sees SOURCING, and asks how that happened. That moment is where projects
 * break — a partner has to become the person who explains the forks, or a
 * flipper blames a contractor for something that was never theirs. The system
 * explains it instead.
 *
 * ATTRIBUTION IS NOT BLAME. A homeowner is allowed to change their mind, and
 * "reopened by: your range change, 14 Aug" is the record of a decision they
 * made — not a mark against them. The copy on this must never read as fault.
 *
 * For bad-faith causes the opposite is true: a contractor's abandonment or
 * breach is named, timestamped, and evidenced, because that record is what the
 * homeowner hands a lawyer or a licensing board. See 0042.
 *
 * `causeKind` + `causeId` point at what did it. Kept as a loose pair rather than
 * a hard FK because the cause is heterogeneous — another decision, an impact, or
 * a direct human act — and a nullable FK per kind would be five columns that are
 * almost always null. The service layer resolves it; the pair is never written
 * without both halves.
 */
export const decisionReopenings = sqliteTable(
  "decision_reopenings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    decisionId: integer("decision_id")
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),

    /** decision | impact | homeowner | contractor | vendor | system */
    causeKind: text("cause_kind").notNull(),

    /** Id within causeKind. Null only when causeKind is a bare human act. */
    causeId: integer("cause_id"),

    /**
     * The one-line explanation the homeowner actually reads, e.g.
     * "kitchen wall relocation". Denormalised ON PURPOSE and named for what it
     * is: a snapshot of the reason AS STATED AT THE TIME. It is not a cached
     * lookup of the cause's current title — if the cause is later renamed, this
     * text must not change, because it is the contemporaneous record of why the
     * homeowner was told their decision reopened.
     */
    reasonAtTime: text("reason_at_time").notNull(),

    /** Who or what recorded it. */
    recordedBy: text("recorded_by"),

    /** When the cause actually happened. */
    occurredAt: integer("occurred_at", { mode: "timestamp" }),

    /** When it was captured here. Immutable — contemporaneous beats reconstructed. */
    recordedAt: integer("recorded_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),

    /** Set when the decision is settled again, so an open reopening is findable. */
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  },
  (table) => ({
    decisionIdx: index("decision_reopenings_decision_idx").on(table.decisionId),
    causeIdx: index("decision_reopenings_cause_idx").on(table.causeKind, table.causeId),
  }),
);
