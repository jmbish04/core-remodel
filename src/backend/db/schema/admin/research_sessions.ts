import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Research Sessions table — tracks AI deep-research orchestration jobs.
 *
 * Lifecycle: pending → researching → embedding → generating → complete | failed
 *
 * Each session stores its Gemini research output in R2, embeds chunks into
 * Vectorize (namespaced by session ID), and generates a single-file visualizer
 * webapp also stored in R2.
 */
export const researchSessions = sqliteTable("research_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  /** The research topic / prompt submitted by the admin */
  topic: text("topic").notNull(),

  /** The full original research prompt text */
  prompt: text("prompt"),

  /** The structured research plan (markdown) */
  researchPlan: text("research_plan"),

  /** Gemini Interactions API ID for the background Deep Research task */
  interactionId: text("interaction_id"),

  /** Last streamed event ID observed while monitoring the interaction */
  lastEventId: text("last_event_id"),

  /** Gemini managed agent ID used for this session */
  interactionAgent: text("interaction_agent"),

  /** Whether a scoped MCP bridge was attached to the interaction */
  mcpBridgeEnabled: integer("mcp_bridge_enabled", { mode: "boolean" }).default(
    false,
  ),

  /**
   * Orchestration status:
   *   pending     — created, not yet started
   *   researching — Gemini deep research in progress
   *   embedding   — chunking + Vectorize upsert in progress
   *   generating  — visualizer webapp generation in progress
   *   complete    — all artifacts saved, ready to view
   *   failed      — terminal failure (see error_message)
   */
  status: text("status", {
    enum: [
      "pending",
      "planning",
      "awaiting_plan_approval",
      "researching",
      "embedding",
      "generating",
      "complete",
      "failed",
    ],
  })
    .notNull()
    .default("pending"),

  /**
   * Plan-review (HITL) sub-state, independent of the run `status`:
   *   none              — plan-review gate not used for this session
   *   drafting          — Gemini is producing the collaborative plan
   *   annotating        — onboard agent is appending review notes
   *   awaiting_approval — plan + annotations ready; waiting on the homeowner
   *   approved          — plan approved; the run has been released
   *   revising          — homeowner requested changes; re-planning
   */
  planStatus: text("plan_status", {
    enum: ["none", "drafting", "annotating", "awaiting_approval", "approved", "revising"],
  })
    .notNull()
    .default("none"),

  /** Onboard-agent annotations on the current plan (JSON array of {kind, note}). */
  planAnnotations: text("plan_annotations"),

  /** Gemini Interactions API id of the collaborative-planning interaction. */
  planInteractionId: text("plan_interaction_id"),

  /** Plan iteration count — increments on each request-changes. */
  planRevision: integer("plan_revision").notNull().default(0),

  /** When the homeowner approved the plan and released the run. */
  planApprovedAt: integer("plan_approved_at", { mode: "timestamp" }),

  /** R2 object key for the raw Markdown research output */
  r2MarkdownKey: text("r2_markdown_key"),

  /** R2 object key for the generated single-file visualizer webapp */
  r2WebappKey: text("r2_webapp_key"),

  /** Vectorize namespace tag — format: `research:{sessionId}` */
  vectorNamespace: text("vector_namespace"),

  /** Human-readable error message when status = "failed" */
  errorMessage: text("error_message"),

  /** Number of chunks embedded into Vectorize */
  chunkCount: integer("chunk_count").default(0),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),

  completedAt: integer("completed_at", { mode: "timestamp" }),
});

/**
 * Research Plan Revisions — one row per plan iteration of the HITL loop.
 *
 * Each time Gemini drafts (or re-drafts after a request-changes) a plan, we
 * snapshot the plan markdown, the onboard agent's annotations, and the
 * homeowner feedback that triggered the revision. Gives a full audit trail of
 * the plan-approval conversation, separate from the live session row.
 */
export const researchPlanRevisions = sqliteTable("research_plan_revisions", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  sessionId: integer("session_id")
    .notNull()
    .references(() => researchSessions.id, { onDelete: "cascade" }),

  /** 0-based iteration index (matches research_sessions.plan_revision). */
  revision: integer("revision").notNull().default(0),

  /** The plan markdown Gemini produced for this revision. */
  planMarkdown: text("plan_markdown").notNull(),

  /** Onboard-agent annotations for this revision (JSON array of {kind, note}). */
  planAnnotations: text("plan_annotations"),

  /** Homeowner feedback that prompted this revision (null for the first draft). */
  homeownerFeedback: text("homeowner_feedback"),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type ResearchSession = typeof researchSessions.$inferSelect;
export type ResearchSessionInsert = typeof researchSessions.$inferInsert;
export type ResearchPlanRevision = typeof researchPlanRevisions.$inferSelect;
export type ResearchPlanRevisionInsert = typeof researchPlanRevisions.$inferInsert;
