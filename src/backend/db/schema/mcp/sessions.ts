import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * MCP Sessions — one row per connected MCP session (0017 ops/observability).
 *
 * Under the Streamable-HTTP `RemodelMcpAgent`, one connected session maps to a
 * single agent Durable Object instance, so `this.getSessionId()` is a stable
 * grouping key for that session's tool calls. The legacy `/api/mcp` bearer
 * transport has no session concept, so it synthesizes a per-request id tagged
 * `"legacy"`.
 *
 * Upserted on the first tool call of a session (see `mcp/logging.ts`); the
 * `mcp_tool_invocations` rows that reference `id` form the per-session
 * tool-usage transcript rendered in the admin ops view.
 */
export const mcpSessions = sqliteTable(
  "mcp_sessions",
  {
    /** The MCP session id, or a synthesized id for the legacy transport. */
    id: text("id").primaryKey(),

    /** Transport that opened the session. */
    transport: text("transport", {
      enum: ["streamable", "sse", "legacy"],
    })
      .notNull()
      .default("streamable"),

    /** Caller identity — `<kind>:<userId>` from the resolved MCP props. */
    principal: text("principal"),

    /** Running count of tool calls logged under this session. */
    toolCallCount: integer("tool_call_count").notNull().default(0),

    firstSeenAt: integer("first_seen_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    lastSeenIdx: index("mcp_sessions_last_seen_idx").on(table.lastSeenAt),
  }),
);

export type McpSession = typeof mcpSessions.$inferSelect;
export type McpSessionInsert = typeof mcpSessions.$inferInsert;
