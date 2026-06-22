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
      "researching",
      "embedding",
      "generating",
      "complete",
      "failed",
    ],
  })
    .notNull()
    .default("pending"),

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
