import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, DESTRUCTIVE } from "../../types";
import { memKey } from "./_shared";

export const deleteAgentMemory = defineTool({
  name: "delete_agent_memory",
  category: "memory",
  title: "Delete an ad-hoc agent memory",
  description:
    "Delete a single memory entry by `memoryUuid` + `entryId`. Idempotent (deleting a missing entry succeeds). Use " +
    "after you have acted on the note, or use flush_agent_memory with clearKv to drain a whole group at once.",
  inputShape: {
    memoryUuid: z.string().describe("The memory-group id."),
    entryId: z.string().describe("The entry id within the group."),
  },
  annotations: DESTRUCTIVE,
  outputShape: {
    deleted: z.boolean(),
    key: z.string(),
  },
  examples: [{ title: "Delete an entry", args: { memoryUuid: "b1e2…", entryId: "c3d4…" } }],
  handler: async ({ env }, input) => {
    const memoryUuid = input.memoryUuid?.trim();
    const entryId = input.entryId?.trim();
    if (!memoryUuid || !entryId) toolError("`memoryUuid` and `entryId` are required.");

    const key = memKey(memoryUuid, entryId);
    await env.AGENT_ADHOC_MEMORY_KV.delete(key);
    return { deleted: true, key };
  },
});
