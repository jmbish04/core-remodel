/**
 * @fileoverview MCP tool — finalize_visit_log (Visit Logs domain, 0032 V2b).
 *
 * Marks a staged/draft visit SUBMITTED, optionally setting the engagement + rating +
 * notes in the same call. Thin wrapper over the shared update service.
 */
import { updateVisitLog } from "@backend/services/showroom/visit-log";
import { z } from "zod";

import { toolError } from "../../format";
import { urlField } from "../../schemas";
import { defineTool, WRITE } from "../../types";
import { toWrite, visitLogUrl, writeShape } from "./_shared";

export const finalizeVisitLogTool = defineTool({
  name: "finalize_visit_log",
  category: "visits",
  title: "Finalize a showroom visit log",
  description:
    "Finalize a pending visit — sets status=SUBMITTED and, in the same call, may set the engagement " +
    "`visit_type`, `rating`, notes, and `departureAt` (which fills dwell). This is the 'I'm done, log it' " +
    "action for a staged/draft row. Returns { ok, id, url }.",
  inputShape: { id: z.number().int().positive().describe("Visit-log id to finalize"), ...writeShape },
  annotations: WRITE,
  outputShape: { ok: z.boolean(), id: z.number().int(), url: urlField },
  examples: [{ title: "Finalize with a rating", args: { id: 12, visitType: "FULL_SESSION", rating: 5 } }],
  handler: async ({ env, db }, input) => {
    const { id, ...rest } = input;
    const ok = await updateVisitLog(db, id, { ...toWrite(rest), status: "SUBMITTED" });
    if (!ok) toolError("Visit log not found. Call list_visit_logs for valid ids.");
    return { ok: true, id, url: visitLogUrl(env, id) };
  },
});
