import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Ad-hoc agent memory — the durable spill-over target for the
 * `AGENT_ADHOC_MEMORY_KV` store.
 *
 * Agents park free-form notes / works-in-progress in KV under a `memoryUuid`
 * (see the `*_agent_memory` MCP tools) when D1 has no home for them yet, D1 is
 * unavailable, or a chat thread is about to run out of room. `flush_agent_memory`
 * drains a uuid's KV entries into this table — one row per KV entry, preserving
 * the raw JSON payload verbatim so nothing is lost — so a later regular-chat
 * session can replay them and take the real actions.
 */
export const agentAdhocMemory = sqliteTable(
  "agent_adhoc_memory",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    /** Groups all entries written during one agent session / train-of-thought. */
    memoryUuid: text("memory_uuid").notNull(),

    /** The originating KV key (`mem:<memoryUuid>:<entryId>`). */
    entryKey: text("entry_key").notNull(),

    /** Optional short label the agent tagged the entry with. */
    label: text("label"),

    /** Raw JSON payload as stored in KV (the memory content envelope). */
    payload: text("payload").notNull(),

    /** When the KV entry was originally written (parsed from the envelope). */
    entryCreatedAt: integer("entry_created_at", { mode: "timestamp" }),

    /** When the entry was flushed from KV into D1. */
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    memoryUuidIdx: index("agent_adhoc_memory_uuid_idx").on(table.memoryUuid),
  }),
);

export type AgentAdhocMemory = typeof agentAdhocMemory.$inferSelect;
export type AgentAdhocMemoryInsert = typeof agentAdhocMemory.$inferInsert;
