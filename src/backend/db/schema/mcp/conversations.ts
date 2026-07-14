import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * MCP Conversations — explicitly-exported chat transcripts (0017 §B).
 *
 * The MCP protocol never delivers the model's conversation to the server, so a
 * chat can only be persisted when the user asks Claude to "save/export our
 * conversation" and Claude calls the `export_conversation` tool with the
 * transcript it holds. This table is where that lands so nothing built in a
 * chat is lost when the chatbot freezes.
 *
 * Large transcripts (> the middleware cap) are offloaded to R2
 * (`ARTIFACTS_BUCKET`) with `content` holding the object key and `storage` set
 * to `"r2"`; small ones live inline (`storage: "inline"`). Re-exporting within
 * the same session updates the existing row (see `export_conversation`).
 */
export const mcpConversations = sqliteTable(
  "mcp_conversations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Session the export came from, when known. */
    sessionId: text("session_id"),

    title: text("title").notNull(),
    summary: text("summary"),

    /** Transcript serialization format. */
    format: text("format", { enum: ["markdown", "json"] })
      .notNull()
      .default("markdown"),

    /** Where `content` lives: inline TEXT, or an R2 object key. */
    storage: text("storage", { enum: ["inline", "r2"] })
      .notNull()
      .default("inline"),

    /** The transcript itself (inline) OR the R2 object key (when storage=r2). */
    content: text("content").notNull(),

    /** Number of messages in the exported transcript (best-effort). */
    messageCount: integer("message_count").notNull().default(0),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    sessionIdx: index("mcp_conversations_session_idx").on(table.sessionId),
    createdAtIdx: index("mcp_conversations_created_at_idx").on(table.createdAt),
  }),
);

export type McpConversation = typeof mcpConversations.$inferSelect;
export type McpConversationInsert = typeof mcpConversations.$inferInsert;
