import { agentAdhocMemory } from "@backend/db";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";
import { memPrefix, parseEnvelope } from "./_shared";

/** Entries drained per KV-fetch + db.batch round. */
const FLUSH_CHUNK = 50;

export const flushAgentMemory = defineTool({
  name: "flush_agent_memory",
  category: "memory",
  title: "Flush a memory group into D1",
  description:
    "Drain a whole memory group from KV into the durable `agent_adhoc_memory` D1 table — one row per entry, " +
    "preserving the raw JSON payload. This is the 'wrap-up' step: after a fresh chat has reviewed (list_agent_memory) " +
    "and acted on the parked notes, flush them so they are archived in D1. Pass `clearKv:true` to also delete the KV " +
    "entries once persisted (so the group isn't re-processed). Returns how many rows were written.",
  inputShape: {
    memoryUuid: z.string().describe("The memory-group id to flush."),
    clearKv: z
      .boolean()
      .optional()
      .describe("Delete each entry from KV after it is persisted to D1 (default false)."),
  },
  annotations: WRITE,
  outputShape: {
    memoryUuid: z.string(),
    persisted: z.number().int(),
    cleared: z.boolean(),
    ids: z.array(z.number().int()),
  },
  examples: [
    { title: "Archive a group", args: { memoryUuid: "b1e2…" } },
    { title: "Archive and clear KV", args: { memoryUuid: "b1e2…", clearKv: true } },
  ],
  handler: async ({ env, db }, input) => {
    const memoryUuid = input.memoryUuid?.trim();
    if (!memoryUuid) toolError("`memoryUuid` is required.");

    const prefix = memPrefix(memoryUuid);
    const list = await env.AGENT_ADHOC_MEMORY_KV.list({ prefix });
    if (list.keys.length === 0) {
      toolError(`No memory entries found for group ${memoryUuid}.`);
    }

    const ids: number[] = [];

    // Chunked: a group can hold up to 1000 entries, and serializing 1000 KV gets
    // + 1000 inserts would itself blow the MCP client timeout this PR exists to
    // avoid. Per chunk we fetch KV in parallel and land the rows in ONE db.batch
    // of single-row inserts (single-row keeps each query under D1's 100-bound-
    // parameter limit — a multi-row VALUES would break past ~16 rows).
    for (let i = 0; i < list.keys.length; i += FLUSH_CHUNK) {
      const chunk = list.keys.slice(i, i + FLUSH_CHUNK);

      const fetched = await Promise.all(
        chunk.map(async (k) => ({
          key: k.name,
          raw: await env.AGENT_ADHOC_MEMORY_KV.get(k.name),
        })),
      );
      const present = fetched.filter((f): f is { key: string; raw: string } => f.raw != null);
      if (present.length === 0) continue;

      const inserts = present.map(({ key, raw }) => {
        const parsed = parseEnvelope(key.slice(prefix.length), raw);
        const parsedDate = parsed?.createdAt ? new Date(parsed.createdAt) : null;
        const entryCreatedAt =
          parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;

        return db
          .insert(agentAdhocMemory)
          .values({
            memoryUuid,
            entryKey: key,
            label: parsed?.label ?? null,
            payload: raw,
            entryCreatedAt,
          })
          .returning({ id: agentAdhocMemory.id });
      });

      const results = await db.batch(
        inserts as [(typeof inserts)[number], ...(typeof inserts)[number][]],
      );
      for (const rows of results) {
        const row = (rows as Array<{ id: number }>)[0];
        if (row) ids.push(row.id);
      }

      if (input.clearKv) {
        await Promise.all(present.map(({ key }) => env.AGENT_ADHOC_MEMORY_KV.delete(key)));
      }
    }

    return { memoryUuid, persisted: ids.length, cleared: !!input.clearKv, ids };
  },
});
