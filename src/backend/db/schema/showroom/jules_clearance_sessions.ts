import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Jules Clearance Sessions — one row per weekly clearance sweep that the
 * JulesClearanceAgent DO runs (0038 Phase B/C).
 *
 * Records the OUR-side `session_uuid` (a `crypto.randomUUID()` minted at job
 * start), the Jules API `jules_session_id` once the repoless VM session is
 * created, and timestamps + the final outcome — so a run on the paid Jules
 * subscription is auditable from D1 (which session was billed, when, what it
 * produced) rather than living only in the DO's ephemeral KV job doc.
 *
 * `jules_session_id` is nullable because a run with no JULES_API_KEY (or one that
 * fails before the session is created) still gets a row for the sweep itself.
 */
export type JulesClearanceStatus =
  | "booting"
  | "running"
  | "awaiting_reply"
  | "fallback"
  | "done"
  | "failed";

export const julesClearanceSessions = sqliteTable(
  "jules_clearance_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Our per-sweep uuid (crypto.randomUUID) — stable handle for this run. */
    sessionUuid: text("session_uuid").notNull(),

    /** The Jules API session id (`sessions/<id>`), once the VM session is created. */
    julesSessionId: text("jules_session_id"),

    /** The DO job id driving this sweep. */
    jobId: text("job_id").notNull(),

    status: text("status").$type<JulesClearanceStatus>().notNull().default("booting"),

    /** Links queued for this sweep. */
    linksTotal: integer("links_total").notNull().default(0),

    // Outcome snapshot, filled on finish (mirrors JulesClearanceSummary).
    pages: integer("pages").notNull().default(0),
    recorded: integer("recorded").notNull().default(0),
    unchanged: integer("unchanged").notNull().default(0),
    empty: integer("empty").notNull().default(0),
    errors: integer("errors").notNull().default(0),
    /** Pages that fell back to Workers-AI because Jules missed/timed out. */
    fallback: integer("fallback").notNull().default(0),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    /** Set when the sweep reaches a terminal state. */
    finishedAt: integer("finished_at", { mode: "timestamp" }),
  },
  (t) => ({
    uuidIdx: index("jules_clearance_sessions_uuid_idx").on(t.sessionUuid),
    julesIdx: index("jules_clearance_sessions_jules_idx").on(t.julesSessionId),
    createdIdx: index("jules_clearance_sessions_created_idx").on(t.createdAt),
  }),
);

export type JulesClearanceSession = typeof julesClearanceSessions.$inferSelect;
export type JulesClearanceSessionInsert = typeof julesClearanceSessions.$inferInsert;
