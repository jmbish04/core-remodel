import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * MCP Agent Issues — the self-improving bug backlog (0017 §C).
 *
 * When Claude (or any agent) hits a defect while using the MCP tools, it logs
 * it via the `report_bug` tool. Coding agents are instructed (AGENTS.md) to
 * check this table before Worker work, fix what they can, and record the fixing
 * PR via `resolve_agent_issue`. The motivating real example: the `/mcp` route
 * prefix gating the docs pages (fixed in PR #81).
 *
 * `dedupeKey` = `<toolName|_>::<summary>` and is uniquely indexed so repeated
 * reports of the same defect update the existing row instead of spamming.
 */
export const mcpAgentIssues = sqliteTable(
  "mcp_agent_issues",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** The MCP tool the bug was hit in, when applicable. */
    toolName: text("tool_name"),

    summary: text("summary").notNull(),
    details: text("details"),

    severity: text("severity", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("medium"),

    reproSteps: text("repro_steps"),

    /** Session the bug was reported from, when known. */
    sessionId: text("session_id"),

    status: text("status", {
      enum: ["open", "in_progress", "fixed", "wontfix"],
    })
      .notNull()
      .default("open"),

    /** PR number that fixed the issue (set by `resolve_agent_issue`). */
    fixedByPr: integer("fixed_by_pr"),
    fixedAt: integer("fixed_at", { mode: "timestamp" }),

    /** `<toolName|_>::<summary>` dedupe key — unique to collapse re-reports. */
    dedupeKey: text("dedupe_key").notNull(),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    dedupeUniq: uniqueIndex("mcp_agent_issues_dedupe_uniq").on(table.dedupeKey),
    statusIdx: index("mcp_agent_issues_status_idx").on(table.status),
    severityIdx: index("mcp_agent_issues_severity_idx").on(table.severity),
  }),
);

export type McpAgentIssue = typeof mcpAgentIssues.$inferSelect;
export type McpAgentIssueInsert = typeof mcpAgentIssues.$inferInsert;
