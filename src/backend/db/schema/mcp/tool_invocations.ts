import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * MCP Tool Invocations — one row per MCP `tools/call` (0017 ops/observability).
 *
 * Written by the cross-cutting logging middleware (`mcp/logging.ts`) from BOTH
 * transports via `ctx.waitUntil`, so logging never adds latency to the tool
 * response. This is the per-call transcript: what tool ran, with what args,
 * whether it succeeded, and how long it took.
 *
 * `sessionId` is plain text (NOT a hard FK) because a legacy per-request
 * session may be inserted in the same batch and ordering isn't guaranteed.
 * `argsJson`/`resultJson` are capped to a size limit with a "…truncated"
 * marker by the middleware; the auth token / WORKER_API_KEY are never logged.
 */
export const mcpToolInvocations = sqliteTable(
  "mcp_tool_invocations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Session this call belongs to (see `mcp_sessions.id`). */
    sessionId: text("session_id").notNull(),

    toolName: text("tool_name").notNull(),

    /** Serialized + size-capped call arguments. */
    argsJson: text("args_json"),

    /** True when the handler returned without throwing. */
    ok: integer("ok", { mode: "boolean" }).notNull().default(true),

    /** Serialized + size-capped successful result (null on error). */
    resultJson: text("result_json"),
    /** Error message when `ok` is false (null on success). */
    errorText: text("error_text"),

    /** Wall-clock handler duration in milliseconds. */
    durationMs: integer("duration_ms"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    sessionIdx: index("mcp_tool_invocations_session_idx").on(table.sessionId),
    toolNameIdx: index("mcp_tool_invocations_tool_name_idx").on(table.toolName),
    createdAtIdx: index("mcp_tool_invocations_created_at_idx").on(table.createdAt),
    okIdx: index("mcp_tool_invocations_ok_idx").on(table.ok),
  }),
);

export type McpToolInvocation = typeof mcpToolInvocations.$inferSelect;
export type McpToolInvocationInsert = typeof mcpToolInvocations.$inferInsert;
