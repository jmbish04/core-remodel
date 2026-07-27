/**
 * @fileoverview MCP tool — list_visit_logs (Visit Logs domain, 0032 V2b).
 */
import { listVisitLogs } from "@backend/services/showroom/visit-log";
import { z } from "zod";

import { looseObject, urlField } from "../../schemas";
import { defineTool, READ_ONLY } from "../../types";
import { visitLogUrl } from "./_shared";

export const listVisitLogsTool = defineTool({
  name: "list_visit_logs",
  category: "visits",
  title: "List showroom visit logs",
  description:
    "List rows from the showroom visit log (the receipts drawer) newest-first. `status=pending` " +
    "returns everything not yet finalized (AI_STAGED / TESLA_SOFT_ARRIVAL / TESLA_STAGED / DRAFT) — " +
    "the 'finish these' queue; `status=completed` returns SUBMITTED visits. Filter to one showroom " +
    "with `storeId`. The store name is JOINed in (never denormalized).",
  inputShape: {
    status: z.enum(["pending", "completed"]).optional().describe("pending = not yet SUBMITTED; completed = SUBMITTED"),
    storeId: z.number().int().positive().optional().describe("Only visits for this registered showroom"),
    limit: z.number().int().min(1).max(500).optional().describe("Max rows (default 200)"),
  },
  annotations: READ_ONLY,
  outputShape: {
    count: z.number().int(),
    visits: z.array(looseObject({ id: z.number().int(), status: z.string(), storeName: z.string().nullable() })),
    url: urlField,
  },
  examples: [{ title: "The pending queue", args: { status: "pending" } }],
  handler: async ({ env, db }, input) => {
    const visits = await listVisitLogs(db, { status: input.status, storeId: input.storeId, limit: input.limit });
    return { count: visits.length, visits, url: visitLogUrl(env) };
  },
});
