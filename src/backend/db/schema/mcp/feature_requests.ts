import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * MCP Feature Requests — the capability-gap backlog (0017 §D).
 *
 * When the user wants something the MCP tools can't do, Claude logs it via the
 * `request_feature` tool. Coding agents are instructed (AGENTS.md) NOT to
 * silently implement these — they surface them and plan with the user first,
 * then set `status='planned'` + `planRef` when a plan doc exists and
 * `prNumber` + `status='shipped'` when merged.
 */
export const mcpFeatureRequests = sqliteTable(
  "mcp_feature_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    title: text("title").notNull(),
    description: text("description").notNull(),

    /** Why the user wants it — the concrete use case driving the request. */
    useCase: text("use_case"),

    /** Who asked (free-text; the single operator today, but future-proofed). */
    requestedBy: text("requested_by"),

    status: text("status", {
      enum: ["requested", "planned", "building", "shipped", "declined"],
    })
      .notNull()
      .default("requested"),

    /** Path to the plan doc once one exists (e.g. `docs/0019_.../PLAN.md`). */
    planRef: text("plan_ref"),
    /** PR number that shipped the feature. */
    prNumber: integer("pr_number"),

    /** Session the request came from, when known. */
    sessionId: text("session_id"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    statusIdx: index("mcp_feature_requests_status_idx").on(table.status),
    createdAtIdx: index("mcp_feature_requests_created_at_idx").on(table.createdAt),
  }),
);

export type McpFeatureRequest = typeof mcpFeatureRequests.$inferSelect;
export type McpFeatureRequestInsert = typeof mcpFeatureRequests.$inferInsert;
