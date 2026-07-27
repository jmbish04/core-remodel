/**
 * @fileoverview MCP tool — delete_visit_log (Visit Logs domain, 0032 V2b).
 */
import { deleteVisitLog, getVisitLog } from "@backend/services/showroom/visit-log";
import { z } from "zod";

import { toolError } from "../../format";
import { defineTool, DESTRUCTIVE } from "../../types";

export const deleteVisitLogTool = defineTool({
  name: "delete_visit_log",
  category: "visits",
  title: "Delete a showroom visit log",
  description:
    "Permanently delete a visit-log row by `id`. Use for a mistaken/duplicate entry — a real visit " +
    "you no longer want counted should usually be edited, not deleted.",
  inputShape: { id: z.number().int().positive().describe("Visit-log id to delete") },
  annotations: DESTRUCTIVE,
  outputShape: { ok: z.boolean(), id: z.number().int() },
  examples: [{ title: "Delete a duplicate", args: { id: 12 } }],
  handler: async ({ db }, input) => {
    const existing = await getVisitLog(db, input.id);
    if (!existing) toolError("Visit log not found. Call list_visit_logs for valid ids.");
    await deleteVisitLog(db, input.id);
    return { ok: true, id: input.id };
  },
});
