/**
 * @fileoverview MCP tool — update_visit_log (Visit Logs domain, 0032 V2b).
 */
import { updateVisitLog } from "@backend/services/showroom/visit-log";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { defineTool, WRITE } from "../../types";
import { toWrite, visitLogUrl, writeShape } from "./_shared";

export const updateVisitLogTool = defineTool({
  name: "update_visit_log",
  category: "visits",
  title: "Update a showroom visit log",
  description:
    "Update any field of a visit-log row by `id` — rating, engagement `visit_type`, notes (PlateJS " +
    "markdown+html), arrival/departure, store link, or `status`. Recomputes dwell when both ends are " +
    "known. To finalize, prefer finalize_visit_log (sets status=SUBMITTED).",
  inputShape: { id: z.number().int().positive().describe("Visit-log id"), ...writeShape },
  annotations: WRITE,
  outputShape: { ok: z.boolean(), id: z.number().int(), url: urlField },
  examples: [{ title: "Grade the engagement + rate", args: { id: 12, visitType: "FULL_SESSION", rating: 4 } }],
  handler: async ({ env, db }, input) => {
    const { id, ...rest } = input;
    const ok = await updateVisitLog(db, id, toWrite(rest));
    if (!ok) toolError("Visit log not found. Call list_visit_logs for valid ids.");
    return { ok: true, id, url: visitLogUrl(env, id) };
  },
});
