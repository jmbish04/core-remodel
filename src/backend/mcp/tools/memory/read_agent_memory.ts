import { z } from "zod";

import { toolError } from "../../format";
import { looseObject } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { memKey, parseEnvelope } from "./_shared";

export const readAgentMemory = defineTool({
  name: "read_agent_memory",
  category: "memory",
  title: "Read one ad-hoc agent memory",
  description:
    "Read a single memory entry by its `memoryUuid` + `entryId` (both returned by write_agent_memory). Errors if " +
    "the entry does not exist.",
  inputShape: {
    memoryUuid: z.string().describe("The memory-group id."),
    entryId: z.string().describe("The entry id within the group."),
  },
  annotations: READ_ONLY,
  outputShape: {
    entry: looseObject({ entryId: z.string(), content: z.string() }),
  },
  examples: [{ title: "Read an entry", args: { memoryUuid: "b1e2…", entryId: "c3d4…" } }],
  handler: async ({ env }, input) => {
    const memoryUuid = input.memoryUuid?.trim();
    const entryId = input.entryId?.trim();
    if (!memoryUuid || !entryId) toolError("`memoryUuid` and `entryId` are required.");

    const raw = await env.AGENT_ADHOC_MEMORY_KV.get(memKey(memoryUuid, entryId));
    const entry = parseEnvelope(entryId, raw);
    if (!entry) toolError(`No memory entry ${entryId} in group ${memoryUuid}.`);

    return { entry };
  },
});
