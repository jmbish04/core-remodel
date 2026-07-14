import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, WRITE } from "../../types";
import { memKey } from "./_shared";

export const writeAgentMemory = defineTool({
  name: "write_agent_memory",
  category: "memory",
  title: "Write an ad-hoc agent memory",
  description:
    "Park a free-form memory / note / work-in-progress in the DURABLE worker KV store so it survives even if this " +
    "chat thread ends or another MCP tool is temporarily unavailable. Entries are grouped by `memoryUuid`: OMIT it " +
    "to start a new group (a fresh uuid is minted and RETURNED — reuse it on later writes to keep related notes " +
    "together), or pass an existing one to append. `content` is whatever you need to remember (plain text or a JSON " +
    "string — e.g. a tool name + payload you couldn't run yet). Later, in a fresh regular chat, list_agent_memory + " +
    "flush_agent_memory replay and persist these. Returns { memoryUuid, entryId }.",
  inputShape: {
    memoryUuid: z
      .string()
      .optional()
      .describe("Existing memory-group id to append to; omit to start a new group (minted + returned)."),
    label: z
      .string()
      .optional()
      .describe("Optional short tag for this entry (e.g. 'todo', 'showroom-payload')."),
    content: z
      .string()
      .describe("The memory content — free-form text or a JSON string. Write whatever you must not lose."),
  },
  annotations: WRITE,
  outputShape: {
    memoryUuid: z.string(),
    entryId: z.string(),
    key: z.string(),
  },
  examples: [
    {
      title: "Start a new memory group",
      args: { label: "todo", content: "Reconcile expense for order #4821 when the tool is back." },
    },
    {
      title: "Append to an existing group",
      args: { memoryUuid: "b1e2…", content: "Also: showroom 121 needs hours set Mon–Fri 9–5." },
    },
  ],
  handler: async ({ env }, input) => {
    const content = input.content?.trim();
    if (!content) toolError("`content` is required and cannot be empty.");

    const memoryUuid = input.memoryUuid?.trim() || crypto.randomUUID();
    const entryId = crypto.randomUUID();
    const key = memKey(memoryUuid, entryId);

    const envelope = {
      entryId,
      label: input.label ?? null,
      content,
      createdAt: new Date().toISOString(),
    };
    await env.AGENT_ADHOC_MEMORY_KV.put(key, JSON.stringify(envelope));

    return { memoryUuid, entryId, key };
  },
});
