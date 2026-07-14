import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { memPrefix, parseEnvelope } from "./_shared";

export const listAgentMemory = defineTool({
  name: "list_agent_memory",
  category: "memory",
  title: "List ad-hoc agent memories",
  description:
    "List every entry in a memory group by `memoryUuid`. Returns each entry's id, label, content, and createdAt. " +
    "Use this at the start of a fresh chat to review what a previous session parked, before acting on it or calling " +
    "flush_agent_memory. Returns up to 1000 entries (the KV list cap) — ample for ad-hoc notes.",
  inputShape: {
    memoryUuid: z.string().describe("The memory-group id returned by write_agent_memory."),
  },
  annotations: READ_ONLY,
  outputShape: {
    memoryUuid: z.string(),
    count: z.number().int(),
    entries: z.array(looseObject({ entryId: z.string(), content: z.string() })),
  },
  examples: [{ title: "List a group", args: { memoryUuid: "b1e2…" } }],
  handler: async ({ env }, input) => {
    const memoryUuid = input.memoryUuid?.trim();
    if (!memoryUuid) toolError("`memoryUuid` is required.");

    const prefix = memPrefix(memoryUuid);
    const list = await env.AGENT_ADHOC_MEMORY_KV.list({ prefix });

    const entries = [];
    for (const k of list.keys) {
      const raw = await env.AGENT_ADHOC_MEMORY_KV.get(k.name);
      const parsed = parseEnvelope(k.name.slice(prefix.length), raw);
      if (parsed) entries.push(parsed);
    }

    return { memoryUuid, count: entries.length, entries };
  },
});
