import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Sourcing Sweep Sessions — gives a showroom deep-sweep a durable identity so a
 * research PLAN can be reviewed and approved across HTTP round-trips.
 *
 * Unlike admin `research_sessions`, the showroom deep-sweep historically ran
 * synchronously inside one request with no place to hold a pending plan. This
 * table backs the Phase 2 plan-review gate: a sweep first drafts + annotates a
 * plan (status `awaiting_plan_approval`), then runs only once the homeowner
 * approves. `target_type` + `target_id` point at the product / store / category
 * the sweep is for.
 */
export const sourcingSweepSessions = sqliteTable(
  "sourcing_sweep_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** What the sweep targets. */
    targetType: text("target_type", { enum: ["product", "store", "category"] }).notNull(),
    /** Id of the product / store / category. */
    targetId: integer("target_id").notNull(),

    /** The reviewed prompt / brief that seeds the plan. */
    prompt: text("prompt"),
    researchMode: text("research_mode", { enum: ["quick", "deep"] }).notNull().default("deep"),
    maxSources: integer("max_sources"),
    enableMcpBridge: integer("enable_mcp_bridge", { mode: "boolean" }).notNull().default(false),

    /** The drafted plan markdown (current revision). */
    planMarkdown: text("plan_markdown"),
    /** Onboard-agent annotations on the current plan (JSON array of {kind, note}). */
    planAnnotations: text("plan_annotations"),
    /** Gemini collaborative-planning interaction id (deep mode). */
    planInteractionId: text("plan_interaction_id"),
    /** Plan-review sub-state. */
    planStatus: text("plan_status", {
      enum: ["drafting", "annotating", "awaiting_approval", "approved", "revising"],
    })
      .notNull()
      .default("drafting"),
    planRevision: integer("plan_revision").notNull().default(0),

    /**
     * Run lifecycle:
     *   planning               — drafting/annotating the plan
     *   awaiting_plan_approval — paused for the homeowner
     *   sweeping               — approved; the extraction sweep is running
     *   complete               — sweep finished (see result_json)
     *   failed                 — terminal failure (see error_message)
     */
    status: text("status", {
      enum: ["planning", "awaiting_plan_approval", "sweeping", "complete", "failed"],
    })
      .notNull()
      .default("planning"),

    /** The sweepResult counts JSON once the run completes. */
    resultJson: text("result_json"),
    errorMessage: text("error_message"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    approvedAt: integer("approved_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => ({
    targetIdx: index("sourcing_sweep_sessions_target_idx").on(table.targetType, table.targetId),
    statusIdx: index("sourcing_sweep_sessions_status_idx").on(table.status),
  }),
);

/**
 * Sourcing Plan Revisions — one row per plan iteration of the sweep HITL loop,
 * mirroring research_plan_revisions for the showroom side.
 */
export const sourcingPlanRevisions = sqliteTable("sourcing_plan_revisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  sweepSessionId: integer("sweep_session_id")
    .notNull()
    .references(() => sourcingSweepSessions.id, { onDelete: "cascade" }),

  revision: integer("revision").notNull().default(0),
  planMarkdown: text("plan_markdown").notNull(),
  planAnnotations: text("plan_annotations"),
  homeownerFeedback: text("homeowner_feedback"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type SourcingSweepSession = typeof sourcingSweepSessions.$inferSelect;
export type SourcingSweepSessionInsert = typeof sourcingSweepSessions.$inferInsert;
export type SourcingPlanRevision = typeof sourcingPlanRevisions.$inferSelect;
export type SourcingPlanRevisionInsert = typeof sourcingPlanRevisions.$inferInsert;
