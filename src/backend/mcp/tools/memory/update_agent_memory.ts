import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, WRITE } from "../../types";
import { memKey, parseEnvelope } from "./_shared";

export const updateAgentMemory = defineTool({
  name: "update_agent_memory",
  category: "memory",
  title: "Update an ad-hoc agent memory",
  description:
    "Replace the `content` and/or `label` of an existing memory entry (by `memoryUuid` + `entryId`). Only the fields " +
    "you pass are changed; the entry's original createdAt is preserved. Errors if the entry does not exist.",
  inputShape: {
    memoryUuid: z.string().describe("The memory-group id."),
    entryId: z.string().describe("The entry id within the group."),
    content: z.string().optional().describe("New content (omit to leave unchanged)."),
    label: z.string().optional().describe("New label (omit to leave unchanged)."),
  },
  annotations: WRITE,
  outputShape: {
    updated: z.boolean(),
    entry: looseObject({ entryId: z.string(), content: z.string() }),
  },
  examples: [
    { title: "Amend content", args: { memoryUuid: "b1e2…", entryId: "c3d4…", content: "Order #4821 reconciled." } },
  ],
  handler: async ({ env }, input) => {
    const memoryUuid = input.memoryUuid?.trim();
    const entryId = input.entryId?.trim();
    if (!memoryUuid || !entryId) toolError("`memoryUuid` and `entryId` are required.");
    if (input.content == null && input.label == null) {
      toolError("Pass `content` and/or `label` to update.");
    }

    const key = memKey(memoryUuid, entryId);
    const existing = parseEnvelope(entryId, await env.AGENT_ADHOC_MEMORY_KV.get(key));
    if (!existing) toolError(`No memory entry ${entryId} in group ${memoryUuid}.`);

    const envelope = {
      entryId,
      label: input.label ?? existing.label,
      content: input.content ?? existing.content,
      createdAt: existing.createdAt || new Date().toISOString(),
    };
    await env.AGENT_ADHOC_MEMORY_KV.put(key, JSON.stringify(envelope));

    return { updated: true, entry: envelope };
  },
});
