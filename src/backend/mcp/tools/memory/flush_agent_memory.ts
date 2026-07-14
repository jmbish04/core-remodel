import { agentAdhocMemory } from "@backend/db";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";
import { memPrefix, parseEnvelope } from "./_shared";

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
    for (const k of list.keys) {
      const raw = await env.AGENT_ADHOC_MEMORY_KV.get(k.name);
      if (raw == null) continue;

      const parsed = parseEnvelope(k.name.slice(prefix.length), raw);
      const parsedDate = parsed?.createdAt ? new Date(parsed.createdAt) : null;
      const entryCreatedAt =
        parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;

      const [row] = await db
        .insert(agentAdhocMemory)
        .values({
          memoryUuid,
          entryKey: k.name,
          label: parsed?.label ?? null,
          payload: raw,
          entryCreatedAt,
        })
        .returning({ id: agentAdhocMemory.id });
      ids.push(row.id);

      if (input.clearKv) await env.AGENT_ADHOC_MEMORY_KV.delete(k.name);
    }

    return { memoryUuid, persisted: ids.length, cleared: !!input.clearKv, ids };
  },
});
