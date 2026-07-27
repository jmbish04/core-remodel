/**
 * @fileoverview MCP tool — get_visit_log (Visit Logs domain, 0032 V2b).
 */
import { getVisitLog } from "@backend/services/showroom/visit-log";
import { z } from "zod";

import { toolError } from "../../format";
import { looseObject, urlField } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { visitLogUrl } from "./_shared";

export const getVisitLogTool = defineTool({
  name: "get_visit_log",
  category: "visits",
  title: "Get one showroom visit log",
  description: "Full detail for one visit-log row by `id`, with the store name JOINed.",
  inputShape: {
    id: z.number().int().positive().describe("Visit-log id (from list_visit_logs)"),
  },
  annotations: READ_ONLY,
  outputShape: {
    visit: looseObject({ id: z.number().int(), status: z.string(), visitType: z.string() }),
    url: urlField,
  },
  examples: [{ title: "By id", args: { id: 12 } }],
  handler: async ({ env, db }, input) => {
    const visit = await getVisitLog(db, input.id);
    if (!visit) toolError("Visit log not found. Call list_visit_logs for valid ids.");
    return { visit, url: visitLogUrl(env, input.id) };
  },
});
